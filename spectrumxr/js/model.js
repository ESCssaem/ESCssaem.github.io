/*
 * SpectrumXR 웹 수업판 — 스펙트럼 계산(브라우저·Node 공용, DOM 없음).
 * SpectrumModel.cs(Spectrum), LightSources.cs(광원 Fill, 기체 셀), Spectroscope.cs(SlitCoverage, 선 맞춤),
 * SpectrumData.cs(WavelengthToColor), Darkroom.cs(단계), RecordSheet.cs(기록·Nearest)를 같은 식으로 옮겼다.
 * 웹에서 바꾼 것은 조준 판정의 차원(3D → 가로 1축)뿐이며 aimOverlap 주석에 적었다.
 */
(function (root, factory) {
  var D = root && root.SPX_DATA ? root.SPX_DATA : (typeof require === 'function' ? require('./data.js') : null);
  var api = factory(D);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SPX_MODEL = api;
})(typeof self !== 'undefined' ? self : this, function (D) {
  'use strict';

  var C = D.CONST;
  var MIN = D.MIN_NM, MAX = D.MAX_NM;
  var BINS = C.spectrumBins;
  var BIN_NM = (MAX - MIN) / BINS;
  var DEG = Math.PI / 180;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function clamp01(v) { return clamp(v, 0, 1); }
  /** Mathf.Lerp: t를 0~1로 자른다. */
  function lerp(a, b, t) { t = clamp01(t); return a + (b - a) * t; }
  /** Mathf.SmoothStep(from, to, t) */
  function smoothStep(from, to, t) { t = clamp01(t); t = -2 * t * t * t + 3 * t * t; return to * t + from * (1 - t); }
  function gauss(d, sigma) { return Math.exp(-0.5 * d * d / (sigma * sigma)); }
  function nmOf(bin) { return MIN + (bin + 0.5) * BIN_NM; }
  function binOf(nm) { return clamp(Math.floor((nm - MIN) / BIN_NM), 0, BINS - 1); }

  // ---------------------------------------------------------------- Spectrum

  function Spectrum() { this.I = new Float32Array(BINS); }

  Spectrum.prototype.clear = function () { this.I.fill(0); return this; };

  /** 연속 스펙트럼. warmth 1이면 빨간 쪽이 더 밝고(백열전구), 0이면 고르게 밝다(고온 광원·별). */
  Spectrum.prototype.addContinuum = function (level, warmth) {
    for (var i = 0; i < BINS; i++) {
      var t = (nmOf(i) - MIN) / (MAX - MIN);
      var shape = lerp(1, 0.45 + 0.75 * t, warmth);
      this.I[i] += level * shape;
    }
    return this;
  };

  Spectrum.prototype.addLine = function (nm, amount) {
    var c = binOf(nm), span = Math.ceil(4 * C.lineSigma / BIN_NM);
    for (var i = Math.max(0, c - span); i <= Math.min(BINS - 1, c + span); i++)
      this.I[i] += amount * gauss(nmOf(i) - nm, C.lineSigma);
    return this;
  };

  Spectrum.prototype.addLines = function (e, level) {
    for (var k = 0; k < e.lines.length; k++) this.addLine(e.lines[k].nm, e.lines[k].rel * level);
    return this;
  };

  /** 흡수선: 그 파장의 밝기를 depth 비율만큼 덜어 낸다(같은 원소의 방출선과 같은 자리). */
  Spectrum.prototype.absorb = function (e, depth) {
    var span = Math.ceil(4 * C.lineSigma / BIN_NM);
    for (var k = 0; k < e.lines.length; k++) {
      var line = e.lines[k];
      var d = depth * lerp(C.absorbRelMin, 1, line.rel);
      var c = binOf(line.nm);
      for (var i = Math.max(0, c - span); i <= Math.min(BINS - 1, c + span); i++)
        this.I[i] *= 1 - clamp01(d * gauss(nmOf(i) - line.nm, C.lineSigma));
    }
    return this;
  };

  Spectrum.prototype.scale = function (k) { for (var i = 0; i < BINS; i++) this.I[i] *= k; return this; };
  Spectrum.prototype.copyFrom = function (o) { this.I.set(o.I); return this; };
  Spectrum.prototype.at = function (nm) { return this.I[binOf(nm)]; };
  Spectrum.prototype.max = function () { var m = 0; for (var i = 0; i < BINS; i++) if (this.I[i] > m) m = this.I[i]; return m; };

  /** 밝기 봉우리(주변보다 밝고 threshold 이상) 파장 목록. */
  Spectrum.prototype.peaks = function (threshold) {
    var I = this.I, out = [];
    for (var i = 1; i < BINS - 1; i++)
      if (I[i] >= threshold && I[i] >= I[i - 1] && I[i] > I[i + 1]) out.push(nmOf(i));
    return out;
  };

  /** 어두운 골(흡수선) 파장 목록: 양옆(±3 nm) 평균보다 ratio 이상 어두운 곳. */
  Spectrum.prototype.dips = function (ratio) {
    var I = this.I, out = [];
    for (var i = 6; i < BINS - 6; i++) {
      var around = 0.5 * (I[i - 6] + I[i + 6]);
      if (around > 0.05 && I[i] < around * (1 - ratio) && I[i] <= I[i - 1] && I[i] < I[i + 1]) out.push(nmOf(i));
    }
    return out;
  };

  /** Spectrum.WriteRow: 칸마다 화면 RGB(0~1). 1보다 밝은 곳은 흰빛이 섞인다. */
  Spectrum.prototype.colors = function (gain) {
    var out = new Array(BINS);
    for (var i = 0; i < BINS; i++) {
      var v = this.I[i] * gain;
      var c = wavelengthToColor(nmOf(i));
      var over = clamp01(v - 1) * 0.6;
      v = clamp01(v);
      out[i] = [lerp(c[0] * v, 1, over), lerp(c[1] * v, 1, over), lerp(c[2] * v, 1, over)];
    }
    return out;
  };

  // ---------------------------------------------------------------- 파장 → 색 (SpectrumData.WavelengthToColor)

  function wavelengthToColor(nm) {
    var r = 0, g = 0, b = 0;
    if (nm < 440) { r = -(nm - 440) / (440 - 380); b = 1; }
    else if (nm < 490) { g = (nm - 440) / (490 - 440); b = 1; }
    else if (nm < 510) { g = 1; b = -(nm - 510) / (510 - 490); }
    else if (nm < 580) { r = (nm - 510) / (580 - 510); g = 1; }
    else if (nm < 645) { r = 1; g = -(nm - 645) / (645 - 580); }
    else { r = 1; }
    var k;
    if (nm < 420) k = 0.35 + 0.65 * (nm - 380) / (420 - 380);
    else if (nm > 680) k = 0.35 + 0.65 * (750 - nm) / (750 - 680);
    else k = 1;
    k = clamp01(k);
    return [Math.pow(r * k, 0.8), Math.pow(g * k, 0.8), Math.pow(b * k, 0.8)];
  }

  // ---------------------------------------------------------------- 광원 (LightSources.cs)

  function fillLamp(s, warmth) { return s.addContinuum(C.lampLevel, warmth); }

  /** 방전관·혼합관: 원소마다 같은 밝기 비율로 단순화. */
  function fillTube(s, elements) {
    for (var i = 0; i < elements.length; i++) s.addLines(elements[i], C.tubeLevel);
    return s;
  }

  function fillStar(s, atmosphere) {
    s.addContinuum(C.starContinuumLevel, C.starContinuumWarmth);
    for (var i = 0; i < atmosphere.length; i++) s.absorb(atmosphere[i], C.starAbsorbDepth);
    return s;
  }

  /** 기체가 내는 빛 ÷ 뒤 광원 빛. 1보다 작으면 흡수선, 1이면 선이 사라지고, 크면 밝은 선. */
  function sourceRatio(tempOffset) { return clamp(1 + C.sourceRatioK * tempOffset, C.sourceRatioMin, C.sourceRatioMax); }
  /** 옆에서 볼 때 가장 센 선의 밝기(방전관 1.1보다 늘 희미). */
  function sideLevel(tempOffset) { return C.sideLevelBase + C.sideLevelK * clamp(tempOffset + 1, 0, 2); }

  function absorptances(gas, a) {
    a.fill(0);
    var sigma = C.gasLineSigma, span = Math.ceil(4 * sigma / BIN_NM);
    for (var k = 0; k < gas.lines.length; k++) {
      var line = gas.lines[k];
      var peak = C.gasAbsorptance * lerp(C.absorbRelMin, 1, line.rel);
      var c = binOf(line.nm);
      for (var i = Math.max(0, c - span); i <= Math.min(BINS - 1, c + span); i++) {
        var d = nmOf(i) - line.nm;
        var ai = peak * Math.exp(-0.5 * d * d / (sigma * sigma));
        a[i] = 1 - (1 - a[i]) * (1 - ai);
      }
    }
    return a;
  }

  /** 일직선: 뒤 광원 빛 중 a만큼 가로막히고, 그 자리에 기체가 내는 빛(광원 × SourceRatio)이 들어온다. */
  function fillStraight(s, gas, tempOffset, lamp) {
    var cont = new Spectrum().addContinuum(lamp.level, lamp.warmth);
    var a = absorptances(gas, new Float32Array(BINS));
    var k = sourceRatio(tempOffset) - 1;
    for (var i = 0; i < BINS; i++) s.I[i] += cont.I[i] * (1 + a[i] * k);
    return s;
  }

  /** 옆: 뒤 광원이 없어 검은 바탕에 기체가 내는 빛만. */
  function fillSide(s, gas, tempOffset) {
    var a = absorptances(gas, new Float32Array(BINS));
    var level = sideLevel(tempOffset) / C.gasAbsorptance;
    for (var i = 0; i < BINS; i++) s.I[i] += a[i] * level;
    return s;
  }

  // ---------------------------------------------------------------- 분광기 (Spectroscope.cs)

  var SLIT_WIDTH = C.tubeRadius * C.slitWidthFactor;
  /** 슬릿 수용각(도): 눈동자 가장자리에서 슬릿 가장자리를 지나는 빛까지. X = 슬릿 길이(가로), Y = 틈(세로). */
  var ACCEPT_HALF_X = Math.atan((SLIT_WIDTH * 0.5 + C.pupilRadius) / C.scopeLength) / DEG;
  var ACCEPT_HALF_Y = Math.atan((C.slitHeight * 0.5 + C.pupilRadius) / C.scopeLength) / DEG;

  /** Spectroscope.SlitCoverage 그대로. x = 틈을 가로지르는 방향(±hx), y = 슬릿 길이 방향(±hy). */
  function slitCoverage(x, y, r, hx, hy) {
    var ax = Math.abs(x);
    var ex = Math.max(0, ax - hx);
    if (ex >= r) return 0;
    var c = Math.sqrt(r * r - ex * ex);
    var y0 = Math.max(y - c, -hy);
    var y1 = Math.min(y + c, hy);
    if (y1 <= y0) return 0;
    var h = smoothStep(0, 1, clamp01((r + hx - ax) / hx));
    var v = (y1 - y0) / Math.min(2 * c, 2 * hy);
    return h * clamp01(v);
  }

  /**
   * 웹 조준 판정(0~1). 원본은 3D 자세로 가로·세로를 함께 보지만, 웹은 실험대 가로 위치 하나(aimX, m)만 고른다.
   * 세로(틈을 가로지르는 방향)는 항상 맞춰져 있다고 보고, 가로 차이를 원본의 '슬릿 길이 방향' 식에 넣는다.
   * - 원판 광원(전구·별·기체 셀): SlitCoverage(0, 가로각, 광원 각반지름, AcceptHalfY, AcceptHalfX) — Unity 호출 순서와 같음
   * - 방전관: TubeOverlap을 1축으로 줄인 것 — 세로로 선 빛기둥(반지름 GlowRadius)이 가로 슬릿 길이 ±tan(AcceptHalfX)와 겹친 비율
   * src: { kind, x, r, dist, yAng? }  (dist = 슬릿에서 광원까지 거리 m, yAng = 기준 시선에서 위아래로 벗어난 각 °)
   * aimTilt: 분광기를 위아래로 기울인 각(°). 원판 광원은 (yAng − aimTilt)를 원본의 '틈을 가로지르는 방향' 인수로 넣는다.
   */
  function aimOverlap(src, aimX, aimTilt) {
    var dx = src.x - aimX, dist = src.dist;
    if (src.kind === 'tube') {
      var xt = dx / dist, w = C.glowRadius / dist, tx = Math.tan(ACCEPT_HALF_X * DEG);
      var lo = Math.max(xt - w, -tx), hi = Math.min(xt + w, tx);
      return hi > lo ? clamp01((hi - lo) / (2 * w)) : 0;
    }
    var xAng = Math.atan2(dx, dist) / DEG;
    var angR = Math.atan2(src.r, Math.sqrt(dist * dist + dx * dx)) / DEG;
    return slitCoverage((src.yAng || 0) - (aimTilt || 0), xAng, angR, ACCEPT_HALF_Y, ACCEPT_HALF_X);
  }

  /** 봉우리 칸 i와 양옆으로 포물선을 맞춘 꼭짓점 파장. */
  function peakNm(I, i) {
    var l = I[i - 1], c = I[i], r = I[i + 1], den = l - 2 * c + r;
    var off = den < -1e-6 ? clamp(0.5 * (l - r) / den, -0.5, 0.5) : 0;
    return nmOf(i) + off * BIN_NM;
  }

  /**
   * Spectroscope.RefreshSnapPeaks: 지금 띠에 따로 보이는 선 목록.
   * 가장 밝은 선의 SnapMinRel 이상이고, 옆 봉우리와의 골이 낮은 쪽 봉우리의 SnapResolve보다 어두워야 따로 센다.
   */
  function snapPeaks(spectrum) {
    var I = spectrum.I, out = [];
    var max = 0;
    for (var i = 0; i < BINS; i++) max = Math.max(max, I[i]);
    if (max <= 1e-4) return out;
    var th = max * C.snapMinRel, last = -1;
    for (i = 1; i < BINS - 1; i++) {
      if (I[i] < th || I[i] < I[i - 1] || I[i] <= I[i + 1]) continue;
      if (last >= 0) {
        var valley = I[i];
        for (var k = last + 1; k < i; k++) valley = Math.min(valley, I[k]);
        if (valley > C.snapResolve * Math.min(I[last], I[i])) {
          if (I[i] > I[last]) { last = i; out[out.length - 1] = peakNm(I, i); }
          continue;
        }
      }
      if (out.length >= 64) break;
      out.push(peakNm(I, i));
      last = i;
    }
    return out;
  }

  // ---------------------------------------------------------------- 암실 (Darkroom.cs)

  function nextDarkLevel(d) {
    for (var i = 0; i < C.darkLevels.length; i++) if (C.darkLevels[i] > d + 0.001) return C.darkLevels[i];
    return C.darkLevels[0];
  }
  function darkLevelName(d) {
    return d >= 0.985 ? '거의 검게' : d >= 0.93 ? '아주 진하게' : d >= 0.85 ? '진하게' : d >= 0.7 ? '보통' : '옅게';
  }

  // ---------------------------------------------------------------- 기록 (RecordSheet.cs)

  function RecordSheet() { this.clear(); }
  RecordSheet.prototype.clear = function () {
    this.continuousAnswer = '';
    this.readings = {};
    this.mixTried = [];
    this.unknownAnswers = ['', ''];
    this.unknownCorrect = [false, false];
    this.sawStraight = false; this.sawSide = false; this.sawCompare = false;
    this.absorptionCondition = '';
    this.absorptionCorrect = false;
    this.starAnswers = ['', ''];
    this.starCorrect = [false, false];
    this.commonElement = '';
    this.commonCorrect = false;
    this.quiz = [-1, -1, -1];
    this.quizCorrect = [false, false, false];
  };
  /** 원소마다 최근 6개까지. */
  RecordSheet.prototype.addReading = function (symbol, nm) {
    var list = this.readings[symbol] || (this.readings[symbol] = []);
    list.push(nm);
    if (list.length > 6) list.shift();
  };
  RecordSheet.prototype.removeLastReading = function (symbol) {
    var list = this.readings[symbol];
    if (!list || list.length === 0) return false;
    list.pop();
    return true;
  };
  RecordSheet.prototype.count = function () {
    var n = 0, k;
    if (this.continuousAnswer) n++;
    for (k in this.readings) n += this.readings[k].length;
    n += this.mixTried.length;
    this.unknownAnswers.concat(this.starAnswers).forEach(function (a) { if (a) n++; });
    if (this.sawStraight) n++; if (this.sawSide) n++; if (this.sawCompare) n++;
    if (this.absorptionCondition) n++;
    if (this.commonElement) n++;
    this.quiz.forEach(function (q) { if (q >= 0) n++; });
    return n;
  };
  /** 읽은 값에서 가장 가까운 그 원소의 선과 차이(nm). */
  function nearest(e, nm) {
    var best = e.lines[0];
    for (var i = 1; i < e.lines.length; i++) if (Math.abs(e.lines[i].nm - nm) < Math.abs(best.nm - nm)) best = e.lines[i];
    return { line: best, diff: Math.abs(best.nm - nm) };
  }

  return {
    BINS: BINS, BIN_NM: BIN_NM,
    ACCEPT_HALF_X: ACCEPT_HALF_X, ACCEPT_HALF_Y: ACCEPT_HALF_Y,
    clamp: clamp, clamp01: clamp01, lerp: lerp, smoothStep: smoothStep,
    nmOf: nmOf, binOf: binOf,
    Spectrum: Spectrum,
    wavelengthToColor: wavelengthToColor,
    fillLamp: fillLamp, fillTube: fillTube, fillStar: fillStar,
    sourceRatio: sourceRatio, sideLevel: sideLevel, fillStraight: fillStraight, fillSide: fillSide,
    slitCoverage: slitCoverage, aimOverlap: aimOverlap, snapPeaks: snapPeaks,
    nextDarkLevel: nextDarkLevel, darkLevelName: darkLevelName,
    RecordSheet: RecordSheet, nearest: nearest
  };
});
