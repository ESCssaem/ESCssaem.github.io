/*
 * SpectrumXR 웹 수업판 — 화면과 수업 흐름.
 * 구역 0~6의 역할·순서·문구·판정은 Stations.cs, 시작·이동·상태 줄은 SpectrumApp.cs, 접안 배치는 EyepieceView.cs를 따른다.
 * Quest 전용 조작(잡기·눈에 대기·스틱·소켓)은 탭/클릭·끌기·키보드로 바꿨다(docs/differences.md).
 */
(function () {
  'use strict';

  var D = window.SPX_DATA, M = window.SPX_MODEL, C = D.CONST, P = D.POSITIONS, ABS = D.ABS, QUIZ = D.QUIZ;

  /** 슬릿에서 실험대 광원까지 거리(m). 원본 배치(분광기 받침 z −0.17 m, 광원 z +0.2 m)에서 잡은 웹 고정값. */
  var VIEW_DIST = 0.4;
  /** 실험대 가로 반폭(m): SpectrumApp.BuildTable 윗면 1.1 m. */
  var BENCH_HALF = 0.55;
  /** 구역에 들어올 때 분광기가 놓이는 자리(실험대 오른쪽 받침, 어떤 광원도 겨누지 않음). */
  var AIM_HOME = 0.5;
  var HOT_LAMP = { level: C.lampLevel, warmth: D.LAMPS.hot.warmth };

  // ------------------------------------------------------------------ 상태

  var S = {
    screen: 'start',
    advanced: false,
    darkness: C.defaultDarkness,
    peek: false,
    zone: -1,
    aimX: AIM_HOME,
    aimTilt: 0,
    sources: [],
    target: null,
    alignment: 0,
    view: 'none',
    spectrum: new M.Spectrum(),
    snapPeaks: [],
    cursorNm: 550,
    readingEnabled: false,
    compareA: null,
    compareB: null,
    status: '',
    record: new M.RecordSheet(),
    z0: { aimed: false, aligned: false, edge: false },
    z2: { inHolder: null },
    z3: { cards: [], picker: [] },
    z4: { angle: 0, temp: 0, gas: 'H', compare: false },
    z5: { picker: [] },
    z6: { q: 0 }
  };

  // ------------------------------------------------------------------ 작은 도구

  function $(sel) { return document.querySelector(sel); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function el(tag, attrs) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'class') e.className = v;
      else e.setAttribute(k, v === true ? '' : v);
    });
    return e;
  }
  function fmt0(v) { return String(Math.round(v)); }
  function fmt1(v) { return (Math.round(v * 10) / 10).toFixed(1); }
  function rgb(c, a) {
    var r = Math.round(c[0] * 255), g = Math.round(c[1] * 255), b = Math.round(c[2] * 255);
    return a == null ? 'rgb(' + r + ',' + g + ',' + b + ')' : 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }
  function benchPct(x) { return (x + BENCH_HALF) / (2 * BENCH_HALF) * 100; }
  function names(list) { return list.length ? list.map(function (e) { return e.name; }).join(' · ') : '(없음)'; }
  function sameSet(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (b.indexOf(a[i]) < 0) return false;
    return true;
  }
  function ok(t) { return '<b class="ok">' + t + '</b>'; }
  function no(t) { return '<b class="no">' + t + '</b>'; }
  function check(done) {
    return done ? '<span class="ck on" aria-label="완료">■</span>' : '<span class="ck" aria-label="아직">□</span>';
  }
  function mark(good) {
    return good ? '<span class="mk ok" title="맞음">○</span>' : '<span class="mk no" title="틀림">×</span>';
  }
  function setStatus(html) { S.status = html; }
  function deltaAngle(a, b) { var d = ((b - a) % 360 + 540) % 360 - 180; return d; }

  // ------------------------------------------------------------------ 광원

  function lampSource(id, key, x) {
    var l = D.LAMPS[key];
    return {
      id: id, kind: 'lamp', label: l.label, name: l.label, x: x, r: P.lampRadius, dist: VIEW_DIST,
      glow: l.glow, lit: true, elements: [],
      fill: function (s) { M.fillLamp(s, l.warmth); }
    };
  }

  function tubeSource(id, label, name, x, elements, glow) {
    return {
      id: id, kind: 'tube', label: label, name: name, x: x, r: P.tubeRadius, dist: VIEW_DIST,
      glow: glow, lit: elements.length > 0, elements: elements,
      fill: function (s) { M.fillTube(s, elements); }
    };
  }

  function lampBehind() { return Math.abs(deltaAngle(S.z4.angle, 0)) < C.straightAngle; }

  function cellName() {
    var g = D.get(S.z4.gas), t = ABS.temps[S.z4.temp];
    return '기체 셀: ' + g.name + '(' + (t < 0 ? '광원보다 온도가 낮은 기체' : t > 0 ? '광원보다 온도가 높은 기체' : '광원과 온도가 같은 기체') + ')';
  }

  function zoneSources() {
    switch (S.zone) {
      case 0: return [lampSource('lamp-practice', 'practice', P.zone0Lamp)];
      case 1: return [lampSource('lamp', 'incandescent', P.zone1Lamp)];
      case 2: {
        var e = S.z2.inHolder;
        return [tubeSource('holder', e ? e.name + '(' + e.symbol + ') 방전관' : '방전관 받침',
          e ? e.name + '(' + e.symbol + ') 방전관' : '방전관 받침(비어 있음)', P.zone2Holder, e ? [e] : [], e ? e.tint : null)];
      }
      case 3: {
        var mix = S.z3.cards.map(D.get);
        var list = [tubeSource('mix', '혼합 방전관', mix.length ? '혼합 방전관: ' + S.z3.cards.join('+') : '혼합 방전관(카드 없음)',
          P.zone3Mix, mix, [0.9, 0.85, 1])];
        var mixes = D.unknownMixes(S.advanced);
        for (var i = 0; i < 2; i++)
          list.push(tubeSource('unknown-' + i, '미지 혼합관 ' + D.UNKNOWN_NAMES[i], '미지 혼합관 ' + D.UNKNOWN_NAMES[i],
            P.zone3Unknown[i], mixes[i].map(D.get), [0.92, 0.9, 0.95]));
        return list;
      }
      case 4: {
        var gas = D.get(S.z4.gas), t = ABS.temps[S.z4.temp];
        var th = S.z4.angle * Math.PI / 180, R = P.zone4TurnRadius;
        var cell = {
          id: 'gascell', kind: 'cell', label: '기체 셀', name: cellName(), x: P.zone4Cell, r: P.cellRadius, dist: VIEW_DIST,
          glow: gas.tint, lit: true, elements: [gas],
          fill: function (s) {
            if (lampBehind()) { S.view = 'straight'; M.fillStraight(s, gas, t, HOT_LAMP); }
            else { S.view = 'side'; M.fillSide(s, gas, t); }
          }
        };
        var lamp = lampSource('hotlamp', 'hot', P.zone4Cell + R * Math.sin(th));
        lamp.dist = VIEW_DIST + R * Math.cos(th);
        lamp.depth = Math.cos(th);
        // Zone4.Tick: 광원 받침은 셀보다 drop만큼 낮아 0°에서는 눈→셀 시선 연장선 위(뒤)에 온다.
        // 시선은 셀 앞뒤로 기울어 있으므로 광원이 앞쪽으로 돌수록 시선 아래로 drop·(1−cosθ)만큼 내려가 셀을 가리지 않는다.
        lamp.yAng = -Math.atan2(P.zone4LampDrop * (1 - lamp.depth), lamp.dist) * 180 / Math.PI;
        return [cell, lamp]; // 원본 Sources 순서: Cell, HotLamp
      }
      case 5: {
        var atm = [D.starA(S.advanced), D.starB(S.advanced)];
        return [0, 1].map(function (k) {
          var els = atm[k].map(D.get);
          return {
            id: 'star-' + k, kind: 'star', label: D.STAR_NAMES[k], name: D.STAR_NAMES[k], x: P.zone5Stars[k], r: P.starRadius,
            dist: VIEW_DIST, glow: [0.95, 0.95, 0.9], lit: true, elements: els,
            fill: function (s) { M.fillStar(s, els); }
          };
        });
      }
      default: return [];
    }
  }

  /** Spectroscope.UpdateSpectrum: 겹침이 가장 큰 광원(비슷하면 가까운 것), 기체 셀 뒤 자기 전구면 셀. */
  function updateScope() {
    S.sources = zoneSources();
    var best = null, bestA = 0, bestDist = Infinity, cellCand = null;
    S.sources.forEach(function (s) {
      var a = M.aimOverlap(s, S.aimX, S.aimTilt);
      if (a <= 0) return;
      if (s.kind === 'cell' && lampBehind()) cellCand = { s: s, a: a };
      var better = !best || a > bestA + 0.15 || (a > bestA - 0.15 && s.dist < bestDist);
      if (better) { best = s; bestA = a; bestDist = s.dist; }
    });
    if (cellCand && best && best.id === 'hotlamp') { best = cellCand.s; bestA = cellCand.a; }
    S.target = best;
    S.alignment = best ? bestA : 0;
    S.view = 'none';
    S.spectrum.clear();
    if (best) {
      var tmp = new M.Spectrum();
      best.fill(tmp);
      S.spectrum.copyFrom(tmp).scale(bestA);
    }
    S.snapPeaks = S.readingEnabled && best && best.kind === 'tube' && best.elements.length ? M.snapPeaks(S.spectrum) : [];

    if (S.zone === 4 && S.z4.compare) {
      var gas = D.get(S.z4.gas), t = ABS.temps[S.z4.temp];
      S.compareA = M.fillStraight(new M.Spectrum(), gas, t, HOT_LAMP);
      S.compareB = M.fillSide(new M.Spectrum(), gas, t).scale(C.compareSideScale);
    } else {
      S.compareA = S.compareB = null;
    }
  }

  // ------------------------------------------------------------------ 구역

  function maxTemp() { return S.advanced ? ABS.temps.length - 1 : ABS.basicMaxTempIndex; }
  function currentNote() { return (lampBehind() ? ABS.tempNotes : ABS.sideNotes)[S.z4.temp]; }
  function compareNote() {
    var t = ABS.temps[S.z4.temp];
    return t < -0.02
      ? '겹쳐 보기: 위(일직선)의 검은 선과 아래(옆)의 밝은 선이 <b>같은 위치</b>에 있어요. 같은 원소는 흡수선과 방출선의 위치가 같아요.'
      : t > 0.02
        ? '겹쳐 보기: 위(일직선)의 밝은 선과 아래(옆)의 밝은 선이 <b>같은 위치</b>에 있어요. 기체가 광원보다 뜨거워 일직선에서도 밝은 선이에요.'
        : '겹쳐 보기: 위(일직선)에는 선이 거의 없지만 아래(옆) 밝은 선과 <b>같은 위치</b>에서 흡수와 방출이 비슷해 서로 지워져요.';
  }

  function setTemp(i, announce) {
    S.z4.temp = M.clamp(i, 0, maxTemp());
    if (announce) setStatus('기체 온도: ' + ABS.tempNames[S.z4.temp] + ' → ' + currentNote() + (S.z4.compare ? '<br>' + compareNote() : ''));
  }

  function markers() {
    if (S.zone === 3) return S.z3.picker.map(D.get);
    if (S.zone === 5) return S.z5.picker.map(D.get);
    return [];
  }

  function readingCountText() {
    var e = S.z2.inHolder;
    if (S.zone !== 2 || !e) return '';
    var list = S.record.readings[e.symbol];
    return e.name + ': 기록 ' + (list ? list.length : 0) + '개';
  }

  function onReading(nm) {
    var e = S.z2.inHolder;
    if (!e || !S.target || S.target.id !== 'holder' || S.alignment < C.alignRecordMin) {
      setStatus('방전관을 받침에 꽂고, 분광기를 그 관에 맞춘 뒤 기록하세요.');
      return;
    }
    S.record.addReading(e.symbol, nm);
    var n = M.nearest(e, nm), good = n.diff <= C.readTolerance;
    setStatus(good
      ? ok(fmt0(nm) + ' nm 기록 ○') + ' ' + e.name + '의 ' + fmt1(n.line.nm) + ' nm 선과 가까워요(차이 ' + fmt1(n.diff) + ' nm).'
      : no(fmt0(nm) + ' nm 기록 ×') + ' 이 근처(±3 nm)에는 ' + e.name + '의 밝은 선이 없어요. 커서를 선 가운데에 맞춰 다시 읽어 보세요.');
  }

  function onUndo() {
    var e = S.z2.inHolder;
    if (e && S.record.removeLastReading(e.symbol)) setStatus('마지막 기록을 지웠어요.');
    else setStatus('지울 기록이 없어요.');
  }

  function togglePick(list, sym) {
    var i = list.indexOf(sym);
    if (i >= 0) list.splice(i, 1); else list.push(sym);
  }

  function judgeUnknown(i) {
    var answer = D.unknownMixes(S.advanced)[i], picked = S.z3.picker;
    var good = sameSet(picked, answer);
    S.record.unknownAnswers[i] = picked.join('+');
    S.record.unknownCorrect[i] = good;
    var right = picked.filter(function (s) { return answer.indexOf(s) >= 0; }).length;
    var extra = picked.length - right, missing = answer.length - right, nm = D.UNKNOWN_NAMES[i];
    if (good) setStatus(ok('정답!') + ' 미지 혼합관 ' + nm + '에는 ' + names(answer.map(D.get)) + '이(가) 들어 있어요. 섞여도 각 원소의 선 위치는 그대로라 선 위치로 구성 원소를 알아낼 수 있어요.');
    else setStatus(no('아직이에요.') + ' ' + nm + ': 고른 원소 중 맞은 것 ' + right + '개' +
      (extra > 0 ? ', 들어 있지 않은 원소 ' + extra + '개' : '') + (missing > 0 ? ', 더 찾을 원소 ' + missing + '개' : '') +
      '. 시야의 모든 밝은 선이 고른 원소의 표시와 맞는지 확인하세요.');
  }

  function judgeStar(i) {
    var answer = i === 0 ? D.starA(S.advanced) : D.starB(S.advanced), picked = S.z5.picker;
    var good = sameSet(picked, answer);
    S.record.starAnswers[i] = picked.join('+');
    S.record.starCorrect[i] = good;
    var right = picked.filter(function (s) { return answer.indexOf(s) >= 0; }).length;
    setStatus(good
      ? ok('정답!') + ' ' + D.STAR_NAMES[i] + '의 대기에는 ' + names(answer.map(D.get)) + '이(가) 있어요. 흡수선의 위치가 그 원소의 방출선 위치와 같아서 알 수 있어요.'
      : no('아직이에요.') + ' ' + D.STAR_NAMES[i] + ': 맞은 원소 ' + right + '개, 고른 원소 ' + picked.length + '개, 들어 있는 원소 ' + answer.length + '개. 검은 선마다 표시가 있는지 확인하세요.');
  }

  function judgeCommon() {
    var a = D.starA(S.advanced), b = D.starB(S.advanced);
    var common = a.filter(function (s) { return b.indexOf(s) >= 0; });
    var picked = S.z5.picker, good = sameSet(picked, common);
    S.record.commonElement = picked.length === 0 ? '(없음)' : picked.join('+');
    S.record.commonCorrect = good;
    setStatus(good
      ? ok('맞아요, 수소예요.') + ' 수소는 우주에서 가장 많은 원소예요(질량으로 약 74%, 헬륨 약 24%). 수소·헬륨 원자핵은 빅뱅 후 처음 몇 분 안에, 원자는 약 38만 년 뒤에 만들어졌어요.'
      : no('다시 찾아보세요.') + ' 공통 원소만 하나 골라 확인하세요. 두 별 모두에서 같은 위치에 있는 검은 선을 찾으면 돼요.');
  }

  // 컨트롤 묶음 도구
  function section(box, title, extraClass) {
    var s = el('div', { class: 'ctl-section' + (extraClass ? ' ' + extraClass : '') });
    if (title) s.appendChild(el('h4', { class: 'ctl-title', text: title }));
    box.appendChild(s);
    return s;
  }
  function btn(id, html, onClick, opts) {
    opts = opts || {};
    var b = el('button', {
      type: 'button', id: id, class: 'btn ' + (opts.cls || 'btn-alt'),
      'aria-pressed': opts.pressed == null ? null : String(!!opts.pressed),
      disabled: !!opts.disabled, html: html
    });
    b.addEventListener('click', function () { act(onClick); });
    return b;
  }
  function grid(parent, cols, items, extraClass) {
    var g = el('div', { class: 'btn-grid' + (extraClass ? ' ' + extraClass : ''), style: '--cols:' + cols });
    items.forEach(function (i) { g.appendChild(i); });
    parent.appendChild(g);
    return g;
  }
  function text(parent, html, cls) { var p = el('p', { class: cls || 'ctl-text', html: html }); parent.appendChild(p); return p; }
  function elemLabel(e) { return '<span class="sym">' + esc(e.symbol) + '</span> ' + esc(e.name); }

  function pickerSection(box, list, title) {
    var s = section(box, title || '기준선 겹쳐 보기 · 답 고르기');
    text(s, '원소를 고르면 접안 시야 띠 위쪽에 그 원소의 선 위치가 표시돼요.');
    grid(s, 3, D.forMode(S.advanced).map(function (e) {
      return btn('pick-' + e.symbol, elemLabel(e), function () { togglePick(list, e.symbol); },
        { cls: 'btn-elem', pressed: list.indexOf(e.symbol) >= 0 });
    }), 'elem-grid');
    return s;
  }

  var ZONES = [
    // ---------------------------------------------------------------- 0구역
    {
      short: '준비', dark: true,
      title: '준비: 분광기를 광원에 겨누기',
      body: '1. 실험대의 연습용 전구를 탭(클릭)하면 분광기가 그쪽을 겨눠요.\n' +
        '2. 접안 시야에서 슬릿 창과 400~700 nm 눈금 위 띠를 확인하세요.\n' +
        '3. 실험대 빈 곳을 좌우로 끌거나 조준 막대를 움직여 슬릿을 전구에서 조금씩 벗어나게 해 보세요.',
      reset: function () { S.z0 = { aimed: false, aligned: false, edge: false }; },
      tick: function () {
        var z = S.z0;
        if (S.target && S.target.id === 'lamp-practice') {
          z.aimed = true;
          if (S.alignment > C.alignZone0) z.aligned = true;
          if (S.alignment > 0 && S.alignment < C.alignHint) z.edge = true;
        }
        setStatus(check(z.aimed) + ' 전구 겨누기 &nbsp; ' + check(z.aligned) + ' 슬릿을 전구에 맞추기 &nbsp; ' +
          check(z.edge) + ' 슬릿을 조금 벗어나게 하기' + (z.aligned ? '<br>' + ok('잘했어요! [다음 ▶]으로 가요.') : ''));
      },
      controls: function (box) {
        var s = section(box, '분광기 쓰는 법');
        text(s, '· 분광기는 슬릿(좁은 틈)으로 들어온 빛을 파장별로 펼쳐 보여 줘요.<br>' +
          '· 광원이 슬릿에 많이 걸릴수록 띠가 밝아요. 맞춤 정도는 실험대 아래 막대에 나와요.<br>' +
          '· 접안 시야 위쪽 슬릿 창에는 지금 슬릿 너머로 보이는 광원이 비쳐요.');
      }
    },
    // ---------------------------------------------------------------- 1구역
    {
      short: '연속', dark: true,
      title: '연속 스펙트럼: 백열전구',
      body: '백열전구 속 필라멘트는 아주 뜨거운 고체예요. 분광기로 전구를 겨누고 눈금 위에 보이는 모습을 관찰하세요.\n' +
        '슬릿을 전구에서 조금씩 벗어나게 하면 띠가 어떻게 되는지도 보세요.\n' +
        '관찰한 모습을 실험 조작에서 고르세요.',
      controls: function (box) {
        var s = section(box, '관찰한 모습은?');
        var opts = [
          ['빨강~보라가 끊김 없이 이어진 띠', '끊김 없이 이어진 띠', true],
          ['어두운 바탕에 밝은 선 몇 개', '밝은 선 몇 개', false],
          ['밝은 띠 사이사이 검은 선', '검은 선이 있는 띠', false]
        ];
        grid(s, 1, opts.map(function (o, i) {
          return btn('answer-cont-' + i, esc(o[0]), function () {
            S.record.continuousAnswer = o[1];
            setStatus(o[2]
              ? ok('맞아요.') + ' 이것이 <b>연속 스펙트럼</b>이에요. 뜨거운 고체·액체나 밀도가 높은 기체처럼 뜨겁고 빽빽한 광원은 모든 파장의 빛을 이어서 내요.'
              : no('다시 보세요.') + ' 분광기를 전구에 정확히 맞추고, 400~700 nm 눈금 위 색이 끊기는 곳이 있는지 보세요.');
          }, { pressed: S.record.continuousAnswer === o[1] });
        }));
      }
    },
    // ---------------------------------------------------------------- 2구역
    {
      short: '방출선', dark: true,
      title: '방출선: 원소마다 다른 선',
      body: '방전관 꽂이에서 원소를 고르면 가운데 받침에 꽂혀 관이 빛나요. 받침을 탭해 겨누고 밝은 선의 위치를 눈금으로 읽으세요.\n' +
        '읽는 법: 접안 시야에서 선을 탭하거나 ◀ 옆 선 / 옆 선 ▶으로 커서를 선에 맞추고 [기록], 잘못 기록하면 [마지막 기록 지우기].\n' +
        '여러 원소를 바꿔 꽂으며 선의 위치를 비교하세요. 활동지에도 같은 순서로 적어요.',
      enter: function () {
        S.readingEnabled = true;
        var e = S.z2.inHolder;
        if (e) setStatus(e.name + ' 방전관이 꽂혀 있어요. 받침을 겨누고 밝은 선을 찾아 위치를 읽어 보세요.');
      },
      modeChanged: function () { S.z2.inHolder = null; },
      reset: function () { S.z2.inHolder = null; },
      controls: function (box) {
        var s = section(box, '방전관 꽂이');
        text(s, '선의 위치는 원소마다 달라요. 밝기는 단순화했고, 읽은 값이 실제 선(NIST)과 ±3 nm 안이면 ○예요.');
        grid(s, 3, D.forMode(S.advanced).map(function (e) {
          return btn('tube-' + e.symbol, elemLabel(e), function () {
            S.z2.inHolder = e;
            setStatus(e.name + ' 방전관을 꽂았어요. 받침을 겨누고 밝은 선을 찾아 위치를 읽어 보세요.');
          }, { cls: 'btn-elem', pressed: S.z2.inHolder === e });
        }), 'elem-grid');
      }
    },
    // ---------------------------------------------------------------- 3구역
    {
      short: '섞기', dark: true,
      title: '원소 섞기와 미지의 혼합관',
      body: '1) 혼합 방전관 카드 꽂이에 원소 카드 2~3장을 꽂으면 그 원소들이 함께 든 관이 켜져요. 섞여도 각 원소의 선 위치가 그대로인지 보세요.\n' +
        '2) 미지 혼합관 (가)·(나)에는 무엇이 들어 있을까요? 원소를 고르면 접안 시야 위에 그 원소의 선 위치가 표시돼요(기준선 겹쳐 보기). 모든 선이 설명되는 조합을 찾아 [답 확인]을 누르세요.\n' +
        '※ 실제로도 혼합 기체관이 있지만 선의 밝기 비율은 조건마다 달라요. 여기서는 밝기를 같게 단순화했어요.',
      modeChanged: function () { S.z3.cards = []; S.z3.picker = []; },
      reset: function () { S.z3.cards = []; S.z3.picker = []; },
      controls: function (box) {
        var s = section(box, '혼합 방전관 카드 꽂이 (3칸)');
        var slots = el('div', { class: 'slots', id: 'card-slots' });
        for (var i = 0; i < 3; i++) {
          var sym = S.z3.cards[i];
          slots.appendChild(el('span', { class: 'slot' + (sym ? ' filled' : ''), text: sym ? sym + ' ' + D.get(sym).name : (i + 1) + '번 칸 비어 있음' }));
        }
        s.appendChild(slots);
        grid(s, 3, D.forMode(S.advanced).map(function (e) {
          return btn('card-' + e.symbol, elemLabel(e), function () {
            var cards = S.z3.cards, k = cards.indexOf(e.symbol);
            if (k >= 0) cards.splice(k, 1);
            else if (cards.length >= 3) { setStatus('카드 꽂이는 3칸이에요. 꽂힌 카드 하나를 빼고 꽂으세요.'); return; }
            else cards.push(e.symbol);
            if (cards.length >= 2) {
              S.record.mixTried.push(cards.join('+'));
              setStatus(names(cards.map(D.get)) + '를 섞었어요. 각 원소 카드의 선 위치와 비교해 보세요.');
            }
          }, { cls: 'btn-elem', pressed: S.z3.cards.indexOf(e.symbol) >= 0 });
        }), 'elem-grid');

        var p = pickerSection(box, S.z3.picker);
        grid(p, 3, [
          btn('judge-unknown-0', '(가) 답 확인', function () { judgeUnknown(0); }, { cls: 'btn-primary' }),
          btn('judge-unknown-1', '(나) 답 확인', function () { judgeUnknown(1); }, { cls: 'btn-primary' }),
          btn('picker-clear', '선택 지우기', function () { S.z3.picker = []; })
        ]);
      }
    },
    // ---------------------------------------------------------------- 4구역
    {
      short: '흡수선', dark: true,
      title: '흡수선: 광원 앞의 기체',
      body: '회전판 가운데 유리 구에는 기체가 들어 있어요. 처음에는 <b>광원보다 온도가 낮은 기체</b>예요(별의 대기처럼 수천 K로 뜨겁지만 광원보다는 낮음).\n' +
        '회전판을 돌리면 광원이 기체 뒤에 있는지가 바뀌어요. 0°는 광원·기체·분광기가 <b>일직선</b>(광원 빛이 기체를 지나옴), 돌리면 광원이 시야에서 빠져 <b>옆</b>에서 기체만 봐요(검은 바탕).\n' +
        "옆에서 보면 기체도 흡수하는 바로 그 파장에서 빛을 내요. 검은 선은 그 파장 빛이 '없는' 게 아니라 기체가 흡수한 뒤 사방으로 다시 내보내 우리 쪽으로 덜 오는 거예요.\n" +
        '기체 온도를 바꿔 두 모습을 비교하고, [겹쳐 보기]로 선 위치를 비교하세요.',
      enter: function () { S.z4.compare = false; },
      exit: function () { S.z4.compare = false; },
      modeChanged: function () {
        setTemp(0, false);
        // 심화에서 고른 Ca가 기본 모드(H·He·Na)에 남으면 고를 버튼이 없으므로 기본 허용값 H로.
        if ((S.advanced ? ABS.gasesAdvanced : ABS.gasesBasic).indexOf(S.z4.gas) < 0) S.z4.gas = 'H';
      },
      reset: function () { S.z4.angle = 0; setTemp(0, false); S.z4.gas = 'H'; S.z4.compare = false; },
      tick: function () {
        if (S.target && S.target.id === 'gascell' && S.alignment > C.alignHint) {
          var rec = S.record;
          if (S.view === 'straight' && ABS.temps[S.z4.temp] < 0 && !rec.sawStraight) {
            rec.sawStraight = true;
            setStatus('일직선: 연속 스펙트럼 속 <b>검은 선(흡수선)</b>이 보여요.');
          }
          if (S.view === 'side' && !rec.sawSide) {
            rec.sawSide = true;
            setStatus('옆: 어두운 바탕에 <b>희미한 밝은 선</b>이 보여요. 흡수한 빛을 사방으로 다시 내보내서 방전관의 선보다 희미해요.');
          }
        }
        if (S.z4.compare && !S.record.sawCompare) {
          S.record.sawCompare = true;
          setStatus(compareNote());
        }
      },
      controls: function (box) {
        var z = S.z4, gas = D.get(z.gas);
        var s = section(box, '회전판 · 기체 온도');
        var straight = lampBehind();
        s.appendChild(turntableSvg());
        text(s, '회전판 ' + Math.round(z.angle) + '° · 지금: <b>' + (straight ? '일직선' : '옆') + '</b> · 기체: ' + esc(gas.name) +
          ' · 기체 온도: ' + esc(ABS.tempNames[z.temp]) + '<br><span class="note">' + esc(currentNote()) + '</span>', 'ctl-text state-text').id = 'abs-state';
        grid(s, 2, [
          btn('turn-left', '◀ 회전판', function () { z.angle = ((z.angle - ABS.angleStep) % 360 + 360) % 360; }),
          btn('turn-right', '회전판 ▶', function () { z.angle = (z.angle + ABS.angleStep) % 360; }),
          btn('temp-down', '▼ 기체 온도', function () { setTemp(z.temp - 1, true); }, { disabled: z.temp <= 0 }),
          btn('temp-up', '기체 온도 ▲', function () { setTemp(z.temp + 1, true); }, { disabled: z.temp >= maxTemp() })
        ]);
        var gases = S.advanced ? ABS.gasesAdvanced : ABS.gasesBasic;
        grid(s, gases.length, gases.map(function (g) {
          return btn('gas-' + g, '기체: ' + esc(D.get(g).name), function () { z.gas = g; }, { pressed: z.gas === g });
        }));
        grid(s, 1, [btn('compare-toggle', z.compare ? '겹쳐 보기 끄기' : '겹쳐 보기 켜기', function () { z.compare = !z.compare; },
          { cls: 'btn-primary', pressed: z.compare })]);
        var q = section(box, '흡수선이 생기는 조건은?');
        grid(q, 1, [
          btn('abs-answer-0', '기체가 광원보다 온도가 낮을 때', function () { absAnswer(0); }, { pressed: S.record.absorptionCondition === '기체가 광원보다 온도가 낮을 때' }),
          btn('abs-answer-1', '기체가 광원보다 온도가 높을 때', function () { absAnswer(1); }, { pressed: S.record.absorptionCondition === '기체가 광원보다 온도가 높을 때' })
        ]);
      }
    },
    // ---------------------------------------------------------------- 5구역
    {
      short: '별', dark: true,
      title: '별 스펙트럼: 별빛 속 원소 찾기',
      body: '망원경으로 모은 미지의 별 가·나의 빛이에요. 별 안쪽에서 나온 빛이 그보다 온도가 낮은 별의 대기를 지나며 흡수선이 생겼어요.\n' +
        '원소를 골라 접안 시야 위에 기준선을 겹쳐 보고, 모든 검은 선이 설명되는 원소를 찾아 [답 확인]을 누르세요.\n' +
        '두 별에 공통으로 들어 있는 원소도 찾아보세요.',
      modeChanged: function () { S.z5.picker = []; },
      reset: function () { S.z5.picker = []; },
      controls: function (box) {
        var p = pickerSection(box, S.z5.picker);
        grid(p, 3, [
          btn('judge-star-0', '별 가 답 확인', function () { judgeStar(0); }, { cls: 'btn-primary' }),
          btn('judge-star-1', '별 나 답 확인', function () { judgeStar(1); }, { cls: 'btn-primary' }),
          btn('judge-common', '공통 원소 확인', judgeCommon, { cls: 'btn-primary' })
        ]);
        grid(p, 1, [btn('picker-clear', '선택 지우기', function () { S.z5.picker = []; })]);
      }
    },
    // ---------------------------------------------------------------- 6구역
    {
      short: '마무리', dark: false,
      title: '마무리: 정리 문항과 나의 기록',
      body: '교실이 다시 밝아져요(가상 암실 꺼짐).\n정리 문항 3개를 풀고, \'나의 기록\'을 보며 종이 활동지를 마무리하세요.',
      enter: function () { S.z6.q = 0; },
      reset: function () {
        for (var i = 0; i < 3; i++) { S.record.quiz[i] = -1; S.record.quizCorrect[i] = false; }
        S.z6.q = 0;
      },
      controls: function (box) {
        var s = section(box, '정리 문항');
        var q = S.z6.q;
        if (q >= 3) {
          var score = S.record.quizCorrect.filter(Boolean).length;
          text(s, '정리 문항 끝! ' + score + '/3 맞혔어요.<br>선의 위치로 원소를 알아내고, 별빛의 흡수선으로 별의 구성 원소를 알 수 있어요.', 'ctl-text quiz-q').id = 'quiz-text';
        } else {
          text(s, esc(QUIZ.questions[q]), 'ctl-text quiz-q').id = 'quiz-text';
          grid(s, 1, [0, 1, 2].map(function (b) {
            return btn('quiz-opt-' + b, esc(QUIZ.options[q][QUIZ.order[q][b]]), function () { quizAnswer(b); });
          }));
        }
        var t = section(box, '');
        grid(t, 1, [btn('btn-title', '처음 화면', requestTitle)]);
        text(t, 'by ESC쌤', 'credit');
      }
    }
  ];

  function absAnswer(choice) {
    var good = choice === 0;
    S.record.absorptionCondition = good ? '기체가 광원보다 온도가 낮을 때' : '기체가 광원보다 온도가 높을 때';
    S.record.absorptionCorrect = good;
    setStatus(good
      ? ok('맞아요.') + ' 광원에서 나온 빛이 그보다 온도가 낮은 기체를 지나면 그 기체가 특정 파장의 빛을 흡수해 검은 선이 생겨요. 별빛의 흡수선도 별의 대기가 안쪽보다 온도가 낮아서 생겨요.'
      : S.advanced
        ? no('다시 확인해요.') + ' 기체 온도를 광원보다 높게 하고 일직선으로 보면 검은 선 대신 밝은 선이 보여요. 온도를 바꿔 가며 비교해 보세요.'
        : no('다시 확인해요.') + ' 온도를 낮추거나 같게 하면서 검은 선이 언제 생기는지 비교해 보세요.');
  }

  function quizAnswer(button) {
    var q = S.z6.q;
    if (q >= 3) return;
    var choice = QUIZ.order[q][button], good = choice === 0;
    S.record.quiz[q] = choice;
    S.record.quizCorrect[q] = good;
    setStatus((good ? ok('맞아요.') + ' ' : no("정답은 '" + esc(QUIZ.options[q][0]) + "'.") + ' ') + esc(QUIZ.explain[q]));
    S.z6.q = q + 1;
  }

  // ------------------------------------------------------------------ 흐름 (SpectrumApp.Go / ShowTitle / StartExperience)

  function startExperience() {
    S.record.clear();
    ZONES.forEach(function (z) { if (z.modeChanged) z.modeChanged(); });
    S.screen = 'lab';
    buildZoneTabs();
    go(0);
  }

  function go(i) {
    if (i < 0) { requestTitle(); return; }
    if (i >= ZONES.length) return;
    var prev = ZONES[S.zone];
    if (prev && prev.exit) prev.exit();
    S.zone = i;
    S.screen = 'lab';
    S.readingEnabled = false;
    S.peek = false;
    S.aimX = AIM_HOME;
    S.aimTilt = 0;
    S.status = '';
    var z = ZONES[i];
    if (z.enter) z.enter();
    setHash('#zone-' + i);
    update({ controls: true, zoneChanged: true });
  }

  function showTitle() {
    var prev = ZONES[S.zone];
    if (prev && prev.exit) prev.exit();
    S.screen = 'start';
    S.zone = -1;
    S.peek = false;
    setHash('#start');
    update({ controls: true });
    var b = $('#btn-start');
    if (b) b.focus();
  }

  function requestTitle() {
    var dlg = $('#confirm-title');
    if (S.record.count() > 0 && dlg && typeof dlg.showModal === 'function') {
      dlg.returnValue = '';
      dlg.showModal();
      var c = $('#confirm-cancel');
      if (c) c.focus();
    } else {
      showTitle();
    }
  }

  function setHash(h) {
    if (location.hash !== h) history.replaceState(null, '', h);
  }

  function act(fn) {
    fn();
    update({ controls: true });
  }

  // ------------------------------------------------------------------ 갱신

  var pendingDraw = false;

  function update(opts) {
    opts = opts || {};
    if (S.screen === 'lab') {
      updateScope();
      var z = ZONES[S.zone];
      if (z && z.tick) z.tick();
    }
    renderScreens();
    renderHeader();
    if (S.screen === 'lab') {
      renderTask(opts.zoneChanged);
      renderBench();
      renderScopePanel();
      renderReadingTools();
      if (opts.controls) renderControls();
      renderRecord();
      renderNav();
      scheduleDraw();
    } else {
      renderStart();
    }
  }

  function renderScreens() {
    $('#screen-start').hidden = S.screen !== 'start';
    $('#screen-lab').hidden = S.screen !== 'lab';
    document.body.setAttribute('data-screen', S.screen);
  }

  function darkroomTarget() {
    if (S.screen !== 'lab' || !ZONES[S.zone] || !ZONES[S.zone].dark) return 0;
    return S.darkness;
  }

  function renderHeader() {
    var pct = Math.round(S.darkness * 100);
    $('#status-line').textContent = (S.advanced ? '심화' : '기본') + ' · 암실 ' + pct + '%';
    var target = darkroomTarget(), applied = S.peek ? 0 : target;
    var chip = $('#darkroom-state'), state, label;
    if (S.screen !== 'lab') { state = 'off'; label = '가상 암실 꺼짐(시작 화면)'; }
    else if (!target) { state = 'off'; label = '가상 암실 꺼짐(마무리)'; }
    else if (S.peek) { state = 'peek'; label = '교실 밝게 보는 중'; }
    else { state = 'on'; label = '가상 암실 ' + M.darkLevelName(S.darkness) + ' ' + pct + '%'; }
    chip.textContent = label;
    chip.setAttribute('data-state', state);
    var dr = $('#darkroom');
    dr.style.opacity = String(applied);
    dr.setAttribute('data-darkness', applied.toFixed(2));
    $('#bench').setAttribute('data-dark', state);
  }

  function renderStart() {
    $('#mode-basic').setAttribute('aria-pressed', String(!S.advanced));
    $('#mode-advanced').setAttribute('aria-pressed', String(S.advanced));
    var label = '교실 어둡기: ' + M.darkLevelName(S.darkness) + ' (' + Math.round(S.darkness * 100) + '%)';
    $('#btn-darkness').textContent = label;
    $('#settings-summary').textContent = '교실 어둡기 ' + M.darkLevelName(S.darkness) + ' (' + Math.round(S.darkness * 100) + '%) · ' + (S.advanced ? '심화 14종' : '기본 6종');
  }

  function buildZoneTabs() {
    var ol = $('#zone-tabs');
    ol.textContent = '';
    ZONES.forEach(function (z, i) {
      var li = el('li');
      var b = el('button', { type: 'button', id: 'zone-tab-' + i, class: 'zone-tab', html: '<span class="zn">' + i + '</span><span class="zl">' + esc(z.short) + '</span>' });
      b.addEventListener('click', function () { go(i); });
      li.appendChild(b);
      ol.appendChild(li);
    });
  }

  function renderTask(zoneChanged) {
    var z = ZONES[S.zone];
    var title = $('#zone-title');
    title.textContent = S.zone + '구역 · ' + z.title;
    if (zoneChanged) {
      $('#zone-body').innerHTML = z.body.split('\n').map(function (l) { return '<span class="line">' + l + '</span>'; }).join('');
    }
    var st = $('#zone-status');
    if (st.innerHTML !== S.status) st.innerHTML = S.status;
    for (var i = 0; i < ZONES.length; i++) {
      var t = $('#zone-tab-' + i);
      if (!t) continue;
      if (i === S.zone) t.setAttribute('aria-current', 'step'); else t.removeAttribute('aria-current');
    }
    if (zoneChanged) {
      var cur = $('#zone-tab-' + S.zone);
      if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
  }

  function renderNav() {
    var prev = $('#btn-prev'), next = $('#btn-next'), peek = $('#btn-peek');
    prev.textContent = S.zone === 0 ? '◀ 처음' : '◀ 이전';
    next.hidden = S.zone >= ZONES.length - 1;
    peek.textContent = S.peek ? '다시 어둡게' : '교실 밝게';
    peek.setAttribute('aria-pressed', String(S.peek));
    peek.disabled = !darkroomTarget();
  }

  // ------------------------------------------------------------------ 실험대 그림

  function glowGrad(id, c) {
    return '<defs><radialGradient id="' + id + '"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="' + rgb(c) + '"/>' +
      '<stop offset="1" stop-color="' + rgb(c, 0) + '"/></radialGradient></defs>';
  }

  function sourceSvg(src) {
    var g = src.glow, id = 'g-' + src.id;
    if (src.kind === 'lamp') {
      return '<svg viewBox="0 0 60 120" aria-hidden="true">' + glowGrad(id, g) +
        '<ellipse cx="30" cy="114" rx="20" ry="4" fill="#2b2f35"/><rect x="28" y="56" width="4" height="58" fill="#8b9096"/>' +
        '<rect x="23" y="50" width="14" height="9" rx="2" fill="#b3a77f"/>' +
        '<circle cx="30" cy="33" r="30" fill="url(#' + id + ')" class="glow"/>' +
        '<circle cx="30" cy="33" r="16" fill="rgba(220,235,255,.25)" stroke="rgba(255,255,255,.6)" stroke-width="1.2"/>' +
        '<path d="M24 40 q3 -12 6 0 q3 -12 6 0" stroke="#fff" stroke-width="1.6" fill="none"/></svg>';
    }
    if (src.kind === 'tube') {
      var lit = src.lit, col = g || [0.6, 0.62, 0.66];
      return '<svg viewBox="0 0 60 120" aria-hidden="true">' + (lit ? glowGrad(id, col) : '') +
        '<rect x="12" y="98" width="36" height="18" rx="2" fill="#2e3238"/><rect x="24" y="104" width="12" height="4" fill="#d75c4d"/>' +
        '<rect x="13" y="14" width="3" height="86" fill="#6b7077"/><rect x="13" y="16" width="16" height="3" fill="#6b7077"/><rect x="13" y="92" width="16" height="3" fill="#6b7077"/>' +
        (lit ? '<ellipse cx="30" cy="55" rx="22" ry="44" fill="url(#' + id + ')" class="glow"/>' : '') +
        '<rect x="25" y="14" width="10" height="82" rx="5" fill="rgba(210,225,240,.22)" stroke="rgba(255,255,255,.55)" stroke-width="1"/>' +
        '<rect x="28" y="20" width="4" height="70" rx="2" fill="' + (lit ? rgb(col) : 'rgba(120,125,135,.6)') + '"/>' +
        '<rect x="24" y="10" width="12" height="5" fill="#9a9ca0"/><rect x="24" y="95" width="12" height="5" fill="#9a9ca0"/></svg>';
    }
    if (src.kind === 'cell') {
      return '<svg viewBox="0 0 60 120" aria-hidden="true">' +
        '<rect x="28" y="62" width="4" height="50" fill="#80858b"/><ellipse cx="30" cy="114" rx="22" ry="4" fill="#2b2f35"/>' +
        '<circle cx="30" cy="38" r="24" fill="' + rgb(g, 0.38) + '" stroke="rgba(255,255,255,.7)" stroke-width="1.4"/>' +
        '<ellipse cx="22" cy="28" rx="6" ry="4" fill="rgba(255,255,255,.45)"/></svg>';
    }
    // star
    return '<svg viewBox="0 0 60 120" aria-hidden="true">' + glowGrad(id, g) +
      '<ellipse cx="30" cy="114" rx="20" ry="4" fill="#2b2f35"/><rect x="28" y="60" width="4" height="54" fill="#8b9096"/>' +
      '<circle cx="30" cy="34" r="30" fill="url(#' + id + ')" class="glow"/><circle cx="30" cy="34" r="11" fill="#fffdf2"/></svg>';
  }

  var benchKey = '';

  function renderBench() {
    var layer = $('#bench-sources');
    var key = S.zone + '|' + (S.target ? S.target.id : '-') + '|' + S.sources.map(function (s) {
      return s.id + ':' + s.x.toFixed(3) + ':' + s.lit + ':' + s.label + ':' + (s.glow ? s.glow.join(',') : '');
    }).join(';');
    if (key !== benchKey) {
      benchKey = key;
      var focusId = document.activeElement && document.activeElement.id;
      layer.textContent = '';
      S.sources.forEach(function (src) {
        var targeted = S.target === src;
        var b = el('button', {
          type: 'button', id: 'source-' + src.id,
          class: 'src src-' + src.kind + (targeted ? ' is-target' : '') + (src.lit ? ' is-lit' : ''),
          'aria-pressed': String(targeted),
          'data-x': src.x.toFixed(3),
          // 셀(2) 위에는 앞쪽에서 떨어져 있는 광원(4)만 그린다. 뒤 광원과 셀 아래로 낮게 겹친 앞 광원(1)은 셀 클릭을 가로채지 않는다.
          style: 'left:' + benchPct(src.x).toFixed(2) + '%' + (src.depth != null ? ';--depth:' + src.depth.toFixed(2) + ';z-index:' +
            (src.depth > 0 || Math.abs(src.x - P.zone4Cell) < 0.12 ? 1 : 4) : ''),
          html: sourceSvg(src) + '<span class="src-label">' + esc(src.label) + '</span>' + (targeted ? '<span class="src-tag">겨눔</span>' : '')
        });
        b.setAttribute('aria-label', src.label + (targeted ? ', 겨누는 중' : ', 겨누기'));
        if (src.depth != null) b.classList.add(src.depth > 0 ? 'is-behind' : 'is-front');
        b.addEventListener('click', function () { aimAt(src.x, src.yAng || 0); });
        layer.appendChild(b);
      });
      if (focusId) { var f = document.getElementById(focusId); if (f && f !== document.activeElement) f.focus({ preventScroll: true }); }
    }
    $('#aim-line').style.left = benchPct(S.aimX).toFixed(2) + '%';
    var range = $('#aim-range');
    var v = Math.round(S.aimX * 1000);
    if (+range.value !== v) range.value = String(v);
    range.setAttribute('aria-valuetext', (S.aimX >= AIM_HOME - 0.001 ? '분광기 받침' : (S.aimX * 100).toFixed(0) + ' cm') +
      (S.target ? ', ' + S.target.label + ' 겨눔 ' + Math.round(S.alignment * 100) + '%' : ', 겨눈 광원 없음'));
  }

  /** tilt: 위아래 기울기(°). 실험대 끌기·조준 막대는 셀·광원 높이 기준 시선(0), 광원 버튼은 그 광원 높이. */
  function aimAt(x, tilt) {
    S.aimX = M.clamp(x, -BENCH_HALF, BENCH_HALF);
    S.aimTilt = tilt || 0;
    update();
  }

  function renderScopePanel() {
    var a = S.alignment, t = S.target;
    $('#target-name').textContent = t ? t.name : '겨눈 광원 없음';
    $('#align-word').textContent = !t ? '벗어남' : a >= C.alignHint ? '맞춤' : '일부만 걸침';
    $('#align-pct').textContent = Math.round(a * 100) + '%';
    $('#align-bar').style.width = (a * 100).toFixed(1) + '%';
    var svg = $('#scope-diagram');
    if (!svg.getAttribute('data-built')) buildScopeDiagram(svg);
    var col = t && t.glow ? rgb(t.glow) : '#9aa3a8';
    $('#sd-source').setAttribute('fill', t ? col : '#c8cdd0');
    $('#sd-rays').setAttribute('opacity', (0.15 + 0.85 * a).toFixed(2));
    $('#sd-rays').setAttribute('stroke', t ? col : '#9aa3a8');
    $('#sd-fan').setAttribute('opacity', (t ? a : 0).toFixed(2));
  }

  function buildScopeDiagram(svg) {
    svg.setAttribute('data-built', '1');
    svg.insertAdjacentHTML('beforeend',
      '<defs><linearGradient id="sd-spec" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#7b3cff"/><stop offset=".25" stop-color="#2a6bff"/><stop offset=".45" stop-color="#21c25a"/>' +
      '<stop offset=".62" stop-color="#f3e23a"/><stop offset=".8" stop-color="#ff8a1f"/><stop offset="1" stop-color="#ff2a1f"/></linearGradient></defs>' +
      '<circle id="sd-source" cx="22" cy="40" r="11"/>' +
      '<path id="sd-rays" d="M34 34 L118 39 M34 40 L118 40 M34 46 L118 41" stroke-width="2" fill="none"/>' +
      '<rect x="118" y="24" width="186" height="32" rx="16" fill="#24365a"/>' +
      '<rect x="116" y="22" width="6" height="15" fill="#8d9298"/><rect x="116" y="43" width="6" height="15" fill="#8d9298"/>' +
      '<rect x="296" y="20" width="8" height="40" rx="2" fill="#3a3355"/>' +
      '<path id="sd-fan" d="M300 40 L346 26 L346 54 Z" fill="url(#sd-spec)"/>' +
      '<ellipse cx="350" cy="40" rx="6" ry="9" fill="#15181b" opacity=".85"/>' +
      '<g class="sd-labels" font-size="10">' +
      '<text x="22" y="66" text-anchor="middle">광원</text>' +
      '<text x="119" y="76" text-anchor="middle">슬릿</text>' +
      '<text x="210" y="44" text-anchor="middle" fill="#e6ecf5">분광기 몸통 15 cm</text>' +
      '<text x="300" y="76" text-anchor="middle">회절격자 필름</text>' +
      '<text x="350" y="16" text-anchor="middle">눈</text></g>');
  }

  function turntableSvg() {
    var z = S.z4, th = z.angle * Math.PI / 180;
    var cx = 100, cy = 78, R = 56;
    var lx = cx + R * Math.sin(th), ly = cy - R * Math.cos(th);
    var straight = lampBehind();
    var gas = D.get(z.gas);
    // createElement('svg')는 HTML 요소가 되어 그려지지 않으므로 문자열로 파싱한다.
    var wrap = el('div', { class: 'turntable-wrap' });
    wrap.innerHTML = '<svg class="turntable" id="turntable-diagram" viewBox="0 0 200 170" role="img" aria-label="' +
      esc('위에서 본 회전판: 광원이 ' + Math.round(z.angle) + '° 자리, ' + (straight ? '광원·기체·분광기가 일직선' : '광원이 시야 밖, 옆에서 기체를 봄')) + '">' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + (R + 10) + '" fill="#2a3036" stroke="#4a535b"/>' +
      '<line x1="' + cx + '" y1="' + cy + '" x2="' + lx.toFixed(1) + '" y2="' + ly.toFixed(1) + '" stroke="#5bd19e" stroke-width="3"/>' +
      '<line x1="' + cx + '" y1="160" x2="' + cx + '" y2="' + (cy - R - 8) + '" stroke="#e8e2b0" stroke-dasharray="4 4" stroke-width="1.4"/>' +
      '<circle cx="' + lx.toFixed(1) + '" cy="' + ly.toFixed(1) + '" r="9" fill="#fff6e0" stroke="#d8b25a" stroke-width="2"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="14" fill="' + rgb(gas.tint, 0.55) + '" stroke="#fff" stroke-width="1.5"/>' +
      '<rect x="' + (cx - 5) + '" y="150" width="10" height="18" rx="3" fill="#24365a"/>' +
      '<text x="' + cx + '" y="' + (cy + 4) + '" text-anchor="middle" font-size="11" fill="#111">' + esc(gas.symbol) + '</text>' +
      '<text x="' + (lx + (Math.sin(th) >= 0 ? 13 : -13)).toFixed(1) + '" y="' + (ly + 4).toFixed(1) + '" text-anchor="' + (Math.sin(th) >= 0 ? 'start' : 'end') + '" font-size="10" fill="#f2f4f5">광원</text>' +
      '<text x="' + (cx + 10) + '" y="164" font-size="10" fill="#c9d1d6">분광기</text>' +
      '<text x="8" y="14" font-size="11" fill="#f2f4f5">' + Math.round(z.angle) + '° · ' + (straight ? '일직선' : '옆') + '</text></svg>';
    return wrap;
  }

  // ------------------------------------------------------------------ 조작 패널·기록

  function renderControls() {
    var box = $('#zone-controls');
    var focusId = document.activeElement && document.activeElement.id;
    box.textContent = '';
    ZONES[S.zone].controls(box);
    if (focusId && box.querySelector('#' + focusId)) document.getElementById(focusId).focus({ preventScroll: true });
  }

  function renderReadingTools() {
    var tools = $('#reading-tools');
    var on = S.readingEnabled && !S.compareA;
    tools.hidden = !on;
    if (!on) return;
    var input = $('#cursor-nm');
    if (document.activeElement !== input) input.value = fmt1(S.cursorNm);
    var hasPeaks = S.snapPeaks.length > 0;
    $('#line-prev').disabled = !hasPeaks;
    $('#line-next').disabled = !hasPeaks;
    $('#btn-undo').disabled = !(S.z2.inHolder && (S.record.readings[S.z2.inHolder.symbol] || []).length);
  }

  function renderRecord() {
    var r = S.record, adv = S.advanced, h = [];
    function dash(v) { return v ? esc(v) : '-'; }
    h.push('<section><h4>1. 연속 스펙트럼</h4><p>보인 모습: ' + dash(r.continuousAnswer) + '</p></section>');
    h.push('<section><h4>2. 방출선 — 읽은 파장(nm)</h4><ul>');
    D.forMode(adv).forEach(function (e) {
      var list = r.readings[e.symbol];
      if (!list || !list.length) { if (e.basic) h.push('<li>' + esc(e.name) + '(' + e.symbol + '): -</li>'); return; }
      h.push('<li id="rec-' + e.symbol + '">' + esc(e.name) + '(' + e.symbol + '): ' + list.map(function (nm) {
        return '<span class="rd">' + fmt0(nm) + mark(M.nearest(e, nm).diff <= C.readTolerance) + '</span>';
      }).join(' ') + '</li>');
    });
    h.push('</ul></section>');
    var tried = r.mixTried.filter(function (v, i, a) { return a.indexOf(v) === i; }).slice(0, 4);
    h.push('<section><h4>3. 원소 섞기</h4><p>켜 본 조합: ' + (tried.length ? esc(tried.join(', ')) : '-') + '</p><ul>');
    for (var i = 0; i < 2; i++)
      h.push('<li>미지 혼합관 ' + D.UNKNOWN_NAMES[i] + ': ' + (r.unknownAnswers[i] ? esc(r.unknownAnswers[i]) + ' ' + mark(r.unknownCorrect[i]) : '-') + '</li>');
    h.push('</ul></section>');
    h.push('<section><h4>4. 흡수선</h4><p>일직선 관찰 ' + (r.sawStraight ? '○' : '-') + ' · 옆 관찰 ' + (r.sawSide ? '○' : '-') + ' · 겹쳐 보기 ' + (r.sawCompare ? '○' : '-') + '</p>' +
      '<p>흡수선이 생기는 조건: ' + (r.absorptionCondition ? esc(r.absorptionCondition) + ' ' + mark(r.absorptionCorrect) : '-') + '</p></section>');
    h.push('<section><h4>5. 별 스펙트럼</h4><p>별 가: ' + (r.starAnswers[0] ? esc(r.starAnswers[0]) + ' ' + mark(r.starCorrect[0]) : '-') +
      ' &nbsp; 별 나: ' + (r.starAnswers[1] ? esc(r.starAnswers[1]) + ' ' + mark(r.starCorrect[1]) : '-') + '</p>' +
      '<p>공통 원소: ' + (r.commonElement ? esc(r.commonElement) + ' ' + mark(r.commonCorrect) : '-') + '</p></section>');
    h.push('<section><h4>6. 정리 문항</h4><p>' + [0, 1, 2].map(function (k) {
      return (k + 1) + '번 ' + (r.quiz[k] < 0 ? '-' : mark(r.quizCorrect[k]));
    }).join(' &nbsp; ') + '</p></section>');
    var html = h.join('');
    var sheet = $('#record-sheet');
    if (sheet.innerHTML !== html) sheet.innerHTML = html;
    $('#record-count').textContent = String(r.count());
  }

  // ------------------------------------------------------------------ 접안 시야 (EyepieceView 배치, 웹 화면에 맞게 띠 폭·글자 크기만 키움)

  var EP = { size: 1024, R: 512, bandHalf: 400, bandY: 10, bandH: 110 };
  EP.scaleTop = EP.bandY - EP.bandH * 0.5 - 6;
  EP.numberY = EP.scaleTop - 60;
  EP.cursorTop = EP.bandY + EP.bandH * 0.5 + 20;
  EP.cursorBottom = EP.scaleTop - 36; // 긴 눈금 끝(−34)까지만: 눈금 숫자를 가로지르지 않게
  EP.markersY = EP.bandY + EP.bandH * 0.5 + 26;
  EP.slitY = 214;
  EP.slitH = 62;
  EP.slitW = EP.slitH * Math.tan(M.ACCEPT_HALF_X * Math.PI / 180) / Math.tan(M.ACCEPT_HALF_Y * Math.PI / 180);
  var SCALE_COLOR = '#dbe0cc';
  var FONT = 'system-ui, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif';

  function epX(nm) { return EP.R + (-EP.bandHalf + (nm - D.MIN_NM) / (D.MAX_NM - D.MIN_NM) * 2 * EP.bandHalf); }
  function epY(y) { return EP.R - y; }
  function nmFromEpX(x) { return D.MIN_NM + (x - (EP.R - EP.bandHalf)) / (2 * EP.bandHalf) * (D.MAX_NM - D.MIN_NM); }

  function scheduleDraw() {
    if (pendingDraw) return;
    pendingDraw = true;
    requestAnimationFrame(function () { pendingDraw = false; drawEyepiece(); });
  }

  function hintText() {
    var t = S.target;
    if (S.compareA) return '';
    if (!t) return '광원을 겨누세요 (실험대에서 탭)';
    if (S.alignment < C.alignHint) return t.kind === 'tube' ? '빛나는 관이 슬릿 틈을 가로지르게' : '슬릿을 광원 가운데에 맞추세요';
    return '';
  }

  function drawBand(ctx, spec, gain, cy, h) {
    var cols = spec.colors(gain), x0 = epX(D.MIN_NM), w = 2 * EP.bandHalf / M.BINS;
    for (var i = 0; i < M.BINS; i++) {
      ctx.fillStyle = rgb(cols[i]);
      ctx.fillRect(x0 + i * w, epY(cy + h / 2), w + 0.7, h);
    }
  }

  function text2(ctx, s, x, y, size, color, align, weight) {
    ctx.font = (weight || '500') + ' ' + size + 'px ' + FONT;
    ctx.fillStyle = color;
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(s, x, epY(y));
  }

  function drawSlit(ctx) {
    var w = EP.slitW, h = EP.slitH, cx = EP.R, cy = epY(EP.slitY);
    var hx = M.ACCEPT_HALF_X, pxPerDeg = (w / 2) / hx;
    ctx.fillStyle = '#121315'; ctx.fillRect(cx - w / 2 - 14, cy - h / 2 - 14, w + 28, h + 28);
    ctx.fillStyle = '#232428'; ctx.fillRect(cx - w / 2 - 9, cy - h / 2 - 9, w + 18, h + 18);
    ctx.fillStyle = '#76787e'; ctx.fillRect(cx - w / 2 - 4, cy - h / 2 - 4, w + 8, h + 8);
    ctx.fillStyle = '#000'; ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
    ctx.save();
    ctx.beginPath(); ctx.rect(cx - w / 2, cy - h / 2, w, h); ctx.clip();
    var list = S.sources.slice().sort(function (a, b) { return b.dist - a.dist; });
    list.forEach(function (s) {
      var xa = Math.atan2(s.x - S.aimX, s.dist) * 180 / Math.PI;
      var px = cx + xa * pxPerDeg;
      if (s.kind === 'tube') {
        var tw = Math.max(3, Math.atan2(C.glowRadius, s.dist) * 180 / Math.PI * pxPerDeg);
        if (Math.abs(px - cx) > w / 2 + tw + 4) return;
        ctx.fillStyle = s.lit ? rgb(s.glow) : 'rgba(110,115,125,.55)';
        if (s.lit) { ctx.shadowColor = rgb(s.glow); ctx.shadowBlur = 18; }
        ctx.fillRect(px - tw, cy - h, 2 * tw, 2 * h);
        ctx.shadowBlur = 0;
        return;
      }
      var rr = Math.atan2(s.r, s.dist) * 180 / Math.PI * pxPerDeg;
      if (Math.abs(px - cx) > w / 2 + rr) return;
      var g = ctx.createRadialGradient(px, cy, 0, px, cy, rr);
      if (s.kind === 'cell') {
        g.addColorStop(0, rgb(s.glow, 0.45)); g.addColorStop(0.92, rgb(s.glow, 0.3)); g.addColorStop(1, 'rgba(255,255,255,.7)');
      } else {
        g.addColorStop(0, '#fff'); g.addColorStop(0.45, rgb(s.glow)); g.addColorStop(1, rgb(s.glow, 0.1));
      }
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(px, cy, rr, 0, Math.PI * 2); ctx.fill();
    });
    ctx.restore();
    text2(ctx, '슬릿', cx - w / 2 - 50, EP.slitY, 24, '#9aa09a');
  }

  function drawMarkers(ctx) {
    var els = markers(), placed = [], minGap = 52, rowGap = 26;
    els.forEach(function (e) {
      var lastLabeled = -999;
      e.lines.forEach(function (line) {
        var x = epX(line.nm);
        ctx.fillStyle = rgb(e.tint);
        ctx.fillRect(x - 1.75, epY(EP.markersY - 14 + 18), 3.5, 36);
        var row = -1;
        if (line.nm - lastLabeled > 8)
          for (var r = 0; r < 3 && row < 0; r++)
            if (!placed.some(function (p) { return p.row === r && Math.abs(p.x - x) < minGap; })) row = r;
        if (row >= 0) {
          placed.push({ x: x, row: row });
          lastLabeled = line.nm;
          text2(ctx, e.symbol, x, EP.markersY + 20 + row * rowGap, 24, rgb(e.tint), 'center', '700');
        }
      });
    });
  }

  function drawCursor(ctx) {
    var x = epX(S.cursorNm), top = epY(EP.cursorTop), bottom = epY(EP.cursorBottom);
    ctx.save();
    ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,.8)';
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,242,140,.95)'; ctx.setLineDash([12, 8]);
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,242,140,.98)'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x - 11, top - 16); ctx.lineTo(x + 11, top - 16); ctx.lineTo(x, top); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 8, bottom - 10); ctx.lineTo(x + 8, bottom - 10); ctx.lineTo(x, bottom); ctx.closePath(); ctx.fill(); ctx.stroke();
    // 값 상자: 눈금 숫자 아래 줄(숫자·'파장 (nm)'과 겹치지 않음)
    var label = fmt1(S.cursorNm) + ' nm', bw = 150, bh = 40;
    var bx = M.clamp(x, epX(D.MIN_NM) + bw / 2 - 30, epX(D.MAX_NM) - bw / 2 + 30), by = epY(EP.numberY - 76);
    ctx.fillStyle = 'rgba(255,242,140,.98)';
    ctx.fillRect(bx - bw / 2, by - bh / 2, bw, bh);
    ctx.font = '700 28px ' + FONT; ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, bx, by + 1);
    ctx.restore();
  }

  function drawEyepiece() {
    var cv = $('#eyepiece');
    if (!cv || S.screen !== 'lab') return;
    var ctx = cv.getContext('2d'), R = EP.R;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, EP.size, EP.size);
    ctx.save();
    ctx.beginPath(); ctx.arc(R, R, R - 2, 0, Math.PI * 2); ctx.closePath();
    ctx.fillStyle = '#000'; ctx.fill();
    ctx.clip();

    var compare = !!(S.compareA && S.compareB);
    var t = S.target;
    var gain = compare || (t && t.kind === 'cell') ? C.gasViewGain : C.bandGain;

    // 위: 광원 이름·안내
    var src = compare ? '겹쳐 보기: 같은 기체' : t ? t.name : '';
    if (src) text2(ctx, src, R, 332, 30, '#b8ccc7', 'center', '600');
    var hint = hintText();
    if (hint) text2(ctx, hint, R, 290, 28, '#ffd95a', 'center', '600');

    if (!compare) drawSlit(ctx);
    drawMarkers(ctx);

    if (compare) {
      var hh = EP.bandH * 0.5 - 6;
      drawBand(ctx, S.compareA, gain, EP.bandY + EP.bandH * 0.25 + 3, hh);
      drawBand(ctx, S.compareB, gain, EP.bandY - EP.bandH * 0.25 - 3, hh);
      // 띠 위 빈자리(슬릿 창이 꺼진 곳)에 두 줄 범례. 띠 안에는 아무것도 덮지 않는다(400~443 nm 선 가림 수정).
      text2(ctx, '위 띠 ▸ 일직선', R, EP.bandY + EP.bandH * 0.5 + 74, 32, SCALE_COLOR, 'center', '700');
      text2(ctx, '아래 띠 ▸ 옆(밝게)', R, EP.bandY + EP.bandH * 0.5 + 34, 32, SCALE_COLOR, 'center', '700');
    } else {
      drawBand(ctx, S.spectrum, gain, EP.bandY, EP.bandH);
    }

    // 눈금: 10 nm 짧은 눈금, 50 nm 긴 눈금 + 숫자
    ctx.fillStyle = SCALE_COLOR;
    ctx.fillRect(epX(D.MIN_NM), epY(EP.scaleTop) - 1.25, 2 * EP.bandHalf, 2.5);
    for (var nm = 400; nm <= 700; nm += 10) {
      var major = nm % 50 === 0, len = major ? 34 : 16, w = major ? 4 : 2.5;
      ctx.fillStyle = SCALE_COLOR;
      ctx.fillRect(epX(nm) - w / 2, epY(EP.scaleTop), w, len);
      if (major) text2(ctx, String(nm), epX(nm), EP.numberY, 36, SCALE_COLOR, 'center', '700');
    }
    text2(ctx, '파장 (nm)', R + EP.bandHalf - 70, EP.numberY - 40, 24, SCALE_COLOR, 'center', '500');

    if (S.readingEnabled && !compare) {
      drawCursor(ctx);
      var lines = [S.snapPeaks.length ? '눈금 읽기: 선을 탭 · ◀▶ 옆 선' : '눈금 읽기: 띠를 탭·끌어 커서 이동', 'Enter 기록 · Backspace 지우기'];
      var cnt = readingCountText();
      if (cnt) lines.push(cnt);
      lines.forEach(function (l, i) { text2(ctx, l, R, -238 - i * 30, 23, '#b8ccc7'); });
    }
    text2(ctx, '선의 밝기는 단순화했어요', R, -340, 21, '#7f8a8a');
    text2(ctx, '선 위치(파장)는 NIST 자료', R, -366, 21, '#7f8a8a');

    // 가장자리 감광(EyeView _Vignette 0.82)
    var v = ctx.createRadialGradient(R, R, R * 0.82, R, R, R);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.92)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, EP.size, EP.size);
    ctx.restore();
    ctx.lineWidth = 4; ctx.strokeStyle = '#2b3136';
    ctx.beginPath(); ctx.arc(R, R, R - 3, 0, Math.PI * 2); ctx.stroke();

    // 접근성 문구
    var label = compare ? '겹쳐 보기: 위 띠 일직선, 아래 띠 옆(밝게)'
      : (t ? t.name + ', 맞춤 ' + Math.round(S.alignment * 100) + '%' : '겨눈 광원 없음') + (S.readingEnabled ? ', 커서 ' + fmt1(S.cursorNm) + ' nm' : '');
    cv.setAttribute('aria-label', '접안 시야: ' + label);
    if (S.readingEnabled && !compare) {
      cv.setAttribute('role', 'slider');
      cv.setAttribute('aria-valuemin', '400'); cv.setAttribute('aria-valuemax', '700');
      cv.setAttribute('aria-valuenow', fmt1(S.cursorNm));
      cv.setAttribute('aria-valuetext', fmt1(S.cursorNm) + ' nm');
    } else {
      cv.setAttribute('role', 'img');
      ['aria-valuemin', 'aria-valuemax', 'aria-valuenow', 'aria-valuetext'].forEach(function (a) { cv.removeAttribute(a); });
    }
    var ro = $('#eyepiece-readout');
    var roText = compare ? '겹쳐 보기 중: 위 = 일직선, 아래 = 옆(밝게)' : t ? t.name + ' · 맞춤 ' + Math.round(S.alignment * 100) + '%' : hintText();
    if (S.readingEnabled && !compare) roText += ' · 커서 ' + fmt1(S.cursorNm) + ' nm';
    if (ro.textContent !== roText) ro.textContent = roText;
  }

  // ------------------------------------------------------------------ 커서

  function setCursor(nm) {
    S.cursorNm = M.clamp(Math.round(nm * 10) / 10, D.MIN_NM, D.MAX_NM);
  }
  /** Spectroscope.StepToPeak: dir 쪽 가장 가까운 보이는 선으로. */
  function stepToPeak(dir) {
    var eps = 0.25, best = null;
    S.snapPeaks.forEach(function (p) {
      if (dir > 0 ? p > S.cursorNm + eps : p < S.cursorNm - eps)
        if (best == null || (dir > 0 ? p < best : p > best)) best = p;
    });
    if (best == null) return false;
    S.cursorNm = best;
    return true;
  }
  function recordCursor() {
    if (!S.readingEnabled) return;
    onReading(S.cursorNm);
    update({ controls: true });
  }
  function undoReading() {
    if (!S.readingEnabled) return;
    onUndo();
    update({ controls: true });
  }

  // ------------------------------------------------------------------ 입력

  function bindPointerDrag(target, opts) {
    var drag = null;
    target.addEventListener('pointerdown', function (e) {
      if (opts.ignore && opts.ignore(e)) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, active: false, mouse: e.pointerType === 'mouse' };
      if (drag.mouse) {
        drag.active = true;
        try { target.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
        opts.move(e, true);
      }
    });
    target.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
      if (!drag.active) {
        // 손가락: 가로로 분명히 움직일 때만 끌기(세로는 브라우저가 페이지 스크롤, touch-action: pan-y)
        if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.2) {
          drag.active = true;
          try { target.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
        } else return;
      }
      opts.move(e, false);
    });
    function end(e, cancelled) {
      if (!drag || e.pointerId !== drag.id) return;
      var d = drag;
      drag = null;
      // 마우스는 누르는 순간 끌기로 시작하므로 active 여부와 상관없이 거의 움직이지 않았으면 탭으로 본다.
      if (!cancelled && (d.mouse || !d.active) && Math.abs(e.clientX - d.x0) < 10 && Math.abs(e.clientY - d.y0) < 10 && opts.tap) opts.tap(e);
    }
    target.addEventListener('pointerup', function (e) { end(e, false); });
    target.addEventListener('pointercancel', function (e) { end(e, true); });
  }

  function benchXFromClient(clientX) {
    var r = $('#bench').getBoundingClientRect();
    return ((clientX - r.left) / r.width) * 2 * BENCH_HALF - BENCH_HALF;
  }

  function epLogicalX(e) {
    var r = $('#eyepiece').getBoundingClientRect();
    return (e.clientX - r.left) * EP.size / r.width;
  }

  function bindInputs() {
    $('#mode-basic').addEventListener('click', function () { S.advanced = false; update(); });
    $('#mode-advanced').addEventListener('click', function () { S.advanced = true; update(); });
    $('#btn-darkness').addEventListener('click', function () { S.darkness = M.nextDarkLevel(S.darkness); update(); });
    $('#btn-start').addEventListener('click', startExperience);

    $('#btn-prev').addEventListener('click', function () { go(S.zone - 1); });
    $('#btn-next').addEventListener('click', function () { go(S.zone + 1); });
    $('#btn-reset').addEventListener('click', function () {
      var z = ZONES[S.zone];
      if (z.reset) z.reset();
      setStatus('이 구역을 처음 상태로 돌렸어요.');
      update({ controls: true });
    });
    $('#btn-peek').addEventListener('click', function () { S.peek = !S.peek; update(); });

    var dlg = $('#confirm-title');
    dlg.addEventListener('close', function () { if (dlg.returnValue === 'ok') showTitle(); });

    // 실험대: 광원 탭은 버튼 click, 빈 곳은 가로 끌기/탭으로 조준
    bindPointerDrag($('#bench'), {
      ignore: function (e) { return !!e.target.closest('.src'); },
      move: function (e) { aimAt(benchXFromClient(e.clientX)); },
      tap: function (e) { aimAt(benchXFromClient(e.clientX)); }
    });
    $('#aim-range').addEventListener('input', function (e) { aimAt(+e.target.value / 1000); });

    // 접안 시야: 탭 = 가까운 선(없으면 그 자리), 가로 끌기 = 커서 이동
    var cv = $('#eyepiece');
    bindPointerDrag(cv, {
      ignore: function () { return !S.readingEnabled || !!S.compareA; },
      move: function (e) { setCursor(nmFromEpX(epLogicalX(e))); update(); },
      tap: function (e) {
        var x = epLogicalX(e), r = cv.getBoundingClientRect(), tol = 16 * EP.size / r.width, best = null;
        S.snapPeaks.forEach(function (p) {
          var d = Math.abs(epX(p) - x);
          if (d <= tol && (best == null || d < Math.abs(epX(best) - x))) best = p;
        });
        if (best != null) S.cursorNm = best; else setCursor(nmFromEpX(x));
        update();
      }
    });
    cv.addEventListener('keydown', function (e) {
      if (!S.readingEnabled || S.compareA) return;
      var handled = true, step = e.shiftKey ? 10 : 1;
      switch (e.key) {
        case 'ArrowLeft': case 'ArrowDown': setCursor(S.cursorNm - step); break;
        case 'ArrowRight': case 'ArrowUp': setCursor(S.cursorNm + step); break;
        case 'PageDown': if (!stepToPeak(-1) && !S.snapPeaks.length) setCursor(S.cursorNm - 10); break;
        case 'PageUp': if (!stepToPeak(1) && !S.snapPeaks.length) setCursor(S.cursorNm + 10); break;
        case 'Home': setCursor(D.MIN_NM); break;
        case 'End': setCursor(D.MAX_NM); break;
        case 'Enter': case ' ': recordCursor(); return e.preventDefault();
        case 'Backspace': case 'Delete': undoReading(); return e.preventDefault();
        default: handled = false;
      }
      if (handled) { e.preventDefault(); update(); }
    });

    $('#line-prev').addEventListener('click', function () { stepToPeak(-1); update(); });
    $('#line-next').addEventListener('click', function () { stepToPeak(1); update(); });
    [['#cursor-m10', -10], ['#cursor-m1', -1], ['#cursor-p1', 1], ['#cursor-p10', 10]].forEach(function (p) {
      $(p[0]).addEventListener('click', function () { setCursor(S.cursorNm + p[1]); update(); });
    });
    var input = $('#cursor-nm');
    input.addEventListener('change', function () {
      var v = parseFloat(input.value);
      if (!isNaN(v)) setCursor(v);
      input.value = fmt1(S.cursorNm);
      update();
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var v = parseFloat(input.value);
        if (!isNaN(v)) setCursor(v);
        input.value = fmt1(S.cursorNm);
        recordCursor();
        e.preventDefault();
      }
    });
    $('#btn-record').addEventListener('click', recordCursor);
    $('#btn-undo').addEventListener('click', undoReading);

    window.addEventListener('hashchange', routeFromHash);
  }

  function routeFromHash() {
    var m = /^#zone-([0-6])$/.exec(location.hash);
    if (m) {
      if (S.screen !== 'lab') { startExperience(); }
      if (S.zone !== +m[1]) go(+m[1]);
    } else if (location.hash === '#start' && S.screen === 'lab') {
      showTitle();
    }
  }

  // ------------------------------------------------------------------ 점검용 읽기 전용 상태 (checks/browser-check.mjs)

  window.__spx = {
    version: 'web-0.1',
    state: function () {
      return JSON.parse(JSON.stringify({
        screen: S.screen, zone: S.zone, advanced: S.advanced, darkness: S.darkness, peek: S.peek,
        darkroomOpacity: S.peek ? 0 : darkroomTarget(),
        aimX: S.aimX, target: S.target ? S.target.id : null, targetName: S.target ? S.target.name : null,
        alignment: S.alignment, view: S.view, readingEnabled: S.readingEnabled, cursorNm: S.cursorNm,
        snapPeaks: S.snapPeaks, compare: !!S.compareA,
        sources: S.sources.map(function (s) { return { id: s.id, x: s.x, kind: s.kind, elements: s.elements.map(function (e) { return e.symbol; }) }; }),
        z2: { inHolder: S.z2.inHolder ? S.z2.inHolder.symbol : null }, z3: S.z3, z4: S.z4, z5: S.z5, z6: S.z6,
        record: S.record, recordCount: S.record.count(),
        status: $('#zone-status') ? $('#zone-status').textContent : ''
      }));
    },
    spectrum: function () { return Array.prototype.slice.call(S.spectrum.I); }
  };

  // ------------------------------------------------------------------ 시작

  function init() {
    var q = new URLSearchParams(location.search);
    if (q.get('mode') === 'advanced') S.advanced = true;
    bindInputs();
    if (window.matchMedia && window.matchMedia('(min-width: 1100px)').matches) $('#record-panel').open = true;
    update({ controls: false });
    routeFromHash();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
