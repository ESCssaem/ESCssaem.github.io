/*
 * SpectrumXR 웹 수업판 — 과학 데이터와 수업 상수.
 * 원본: 승인 Quest v0.2.8(10) 소스 사본(.reference/)
 *   SpectrumData.cs  원소 선(NIST ASD 중성 원자 공기 중 파장, nm)·상대 밝기(단순화)·표시색·미지 혼합관·별 가/나·WavelengthToColor
 *   SpectrumModel.cs Bins 600, LineSigma 0.9 nm
 *   LightSources.cs  광원 밝기·기체 셀(ViewGain, LineSigma 1.3, Absorptance 0.9, SourceRatio, SideLevel)
 *   Spectroscope.cs  슬릿·눈동자 치수, 선 맞춤(SnapMinRel, SnapResolve)
 *   EyepieceView.cs  BandGain 1.3
 *   Darkroom.cs      암실 단계
 *   Stations.cs      구역 문구·기체 온도 단계·정리 문항·보기 순서
 * 값은 손으로 옮겼고 checks/data-check.js 가 .reference 의 C# 원문을 읽어 기계 대조한다. 값을 바꾸지 말 것.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SPX_DATA = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function L(nm, rel) { return { nm: nm, rel: rel }; }
  function E(symbol, name, basic, tint, note, lines) {
    return { symbol: symbol, name: name, basic: basic, tint: tint, note: note, lines: lines };
  }

  // SpectrumData.All — 순서도 원본과 같다(활동지 원소 순서 H·He·Ne·Hg·Na·Li, 심화 + Ar·Kr·Xe·Ca·Fe·K·Mg·Cd).
  var ELEMENTS = [
    E('H', '수소', true, [0.95, 0.45, 0.65], '발머 계열 네 선',
      [L(410.17, 0.22), L(434.05, 0.35), L(486.13, 0.62), L(656.28, 1.0)]),
    E('He', '헬륨', true, [1.0, 0.82, 0.55], '노란 587.6 nm 선이 가장 밝다',
      [L(447.15, 0.55), L(471.31, 0.22), L(492.19, 0.25), L(501.57, 0.45), L(587.56, 1.0), L(667.82, 0.40)]),
    E('Ne', '네온', true, [1.0, 0.42, 0.25], '주황·빨강 선이 많다(대표 선만 표시)',
      [L(540.06, 0.35), L(585.25, 0.80), L(588.19, 0.45), L(594.48, 0.45), L(603.00, 0.40), L(607.43, 0.45),
       L(614.31, 0.55), L(626.65, 0.45), L(640.22, 0.85), L(650.65, 0.60), L(692.95, 0.50)]),
    E('Hg', '수은', true, [0.62, 0.72, 1.0], '보라·파랑·초록·노랑 선',
      [L(404.66, 0.55), L(435.83, 0.85), L(546.07, 1.0), L(576.96, 0.55), L(579.07, 0.55)]),
    E('Na', '나트륨', true, [1.0, 0.75, 0.20], '589.0·589.6 nm 두 선이 붙어 한 줄처럼 보인다',
      [L(588.995, 1.0), L(589.592, 0.85)]),
    E('Li', '리튬', true, [0.95, 0.30, 0.30], '빨간 670.8 nm 선이 가장 밝다',
      [L(413.26, 0.12), L(460.29, 0.18), L(610.36, 0.40), L(670.78, 1.0)]),

    E('Ar', '아르곤', false, [0.75, 0.55, 1.0], '보라 선 여럿과 빨간 선',
      [L(415.86, 0.55), L(420.07, 0.55), L(451.07, 0.35), L(603.21, 0.30), L(675.28, 0.45), L(687.13, 0.45), L(696.54, 1.0)]),
    E('Kr', '크립톤', false, [0.85, 0.85, 0.95], '파랑 선 여럿과 초록·노랑 선',
      [L(427.40, 0.65), L(431.96, 0.65), L(437.61, 0.55), L(446.37, 0.55), L(557.03, 0.85), L(587.09, 1.0), L(645.63, 0.35)]),
    E('Xe', '제논', false, [0.55, 0.75, 1.0], '파랑 선이 몰려 있다',
      [L(473.42, 0.85), L(480.70, 0.75), L(482.97, 0.65), L(484.33, 0.55), L(491.65, 0.75), L(492.32, 0.75), L(631.81, 0.70)]),
    E('Ca', '칼슘', false, [0.95, 0.55, 0.35], '보라 422.7 nm 선이 강하다',
      [L(422.67, 1.0), L(445.48, 0.50), L(585.75, 0.45), L(612.22, 0.45), L(616.22, 0.45), L(643.91, 0.55),
       L(646.26, 0.50), L(649.38, 0.50)]),
    E('Fe', '철', false, [0.75, 0.70, 0.65], '선이 매우 많다(대표 선 8개만 표시)',
      [L(404.58, 1.0), L(406.36, 0.80), L(427.18, 0.65), L(430.79, 0.65), L(438.35, 0.45), L(440.48, 0.75),
       L(526.95, 0.85), L(532.80, 0.70)]),
    E('K', '칼륨', false, [0.85, 0.55, 0.95], '가장 강한 766·770 nm 선은 눈금(700 nm) 밖이라 보이지 않는다',
      [L(404.41, 0.80), L(404.72, 0.75), L(691.11, 0.45), L(693.88, 0.50)]),
    E('Mg', '마그네슘', false, [0.70, 0.95, 0.70], '초록 516.7·517.3·518.4 nm 세 선',
      [L(470.30, 0.30), L(516.73, 0.80), L(517.27, 0.90), L(518.36, 1.0), L(552.84, 0.65)]),
    E('Cd', '카드뮴', false, [0.95, 0.65, 0.75], '파랑·초록 선과 빨간 643.8 nm 선',
      [L(467.81, 0.45), L(479.99, 0.60), L(508.58, 0.85), L(643.85, 1.0)])
  ];

  var BY_SYMBOL = {};
  ELEMENTS.forEach(function (e) { BY_SYMBOL[e.symbol] = e; });

  return {
    SOURCE: 'SpectrumXR Quest v0.2.8(10) 승인 소스',
    MIN_NM: 400,
    MAX_NM: 700,
    ELEMENTS: ELEMENTS,
    get: function (symbol) {
      var e = BY_SYMBOL[symbol];
      if (!e) throw new Error('unknown element ' + symbol);
      return e;
    },
    forMode: function (advanced) { return advanced ? ELEMENTS.slice() : ELEMENTS.filter(function (e) { return e.basic; }); },

    // SpectrumData.UnknownMixes / StarA / StarB
    unknownMixes: function (advanced) {
      return advanced ? [['Li', 'Hg', 'Xe'], ['Na', 'Ar', 'Cd']] : [['H', 'Li'], ['He', 'Hg']];
    },
    starA: function () { return ['H', 'He']; },
    starB: function (advanced) { return advanced ? ['H', 'Na', 'Ca', 'Fe'] : ['H', 'Na']; },

    CONST: {
      readTolerance: 3,            // SpectrumData.ReadTolerance (±nm)
      spectrumBins: 600,           // Spectrum.Bins (0.5 nm 칸)
      lineSigma: 0.9,              // Spectrum.LineSigma (nm)
      lampLevel: 0.95,             // LampSource.Level
      tubeLevel: 1.1,              // TubeSource.Level
      starContinuumLevel: 0.95,    // StarSource.Fill AddContinuum(0.95, 0.15)
      starContinuumWarmth: 0.15,
      starAbsorbDepth: 0.85,       // StarSource.Fill Absorb(e, 0.85)
      absorbRelMin: 0.65,          // Spectrum.Absorb / GasCell Absorptances: Lerp(0.65, 1, rel)
      gasViewGain: 0.8,            // GasCellSource.ViewGain
      gasLineSigma: 1.3,           // GasCellSource.LineSigma
      gasAbsorptance: 0.9,         // GasCellSource.Absorptance
      sourceRatioK: 0.85, sourceRatioMin: 0.1, sourceRatioMax: 1.9, // SourceRatio
      sideLevelBase: 0.24, sideLevelK: 0.3,                          // SideLevel
      compareSideScale: 2.5,       // Zone4 겹쳐 보기 옆 띠 배율
      bandGain: 1.3,               // EyepieceView.BandGain
      snapMinRel: 0.05, snapResolve: 0.85, // Spectroscope 선 맞춤
      scopeLength: 0.15, tubeRadius: 0.019, slitWidthFactor: 1.4, slitHeight: 0.002, pupilRadius: 0.003, // Spectroscope 치수(m)
      glowRadius: 0.005,           // Models.GlowRadius (방전관 빛기둥 반지름 m)
      darkLevels: [0.65, 0.82, 0.9, 0.95, 0.99], // Darkroom.Levels
      defaultDarkness: 0.82,       // Darkroom.DefaultDarkness
      alignRecordMin: 0.3,         // Zone2.OnReading Alignment < 0.3 이면 기록 거부
      alignHint: 0.6,              // EyepieceView 힌트, Zone4 관찰 판정
      alignZone0: 0.8,             // Zone0 '슬릿을 전구에 맞추기'
      straightAngle: 7.5           // Zone4 CurrentView: |각도| < 7.5° 이면 일직선
    },

    // Models.Lamp(... glow, warmth, label) 호출값(Stations.cs Build)
    LAMPS: {
      practice: { label: '연습용 전구', glow: [1.0, 0.85, 0.55], warmth: 1.0 },
      incandescent: { label: '백열전구', glow: [1.0, 0.78, 0.45], warmth: 1.0 },
      hot: { label: '고온 광원', glow: [1.0, 0.97, 0.9], warmth: 0.15 }
    },

    // 실험대 위 x 위치(m)와 판정 반지름(m): Stations.cs Build / Models.cs
    POSITIONS: {
      zone0Lamp: 0, zone1Lamp: 0, zone2Holder: 0.02,
      zone3Mix: -0.12, zone3Unknown: [0.10, 0.27],
      zone4Cell: 0, zone4TurnRadius: 0.17,
      zone4LampDrop: 0.105,        // Zone4.Tick drop 기본값: 0°에서 광원이 눈→셀 시선 연장선 위에 오도록 셀보다 낮춘 높이(m)
      zone5Stars: [-0.16, 0.16],
      lampRadius: 0.035, tubeRadius: 0.03, cellRadius: 0.05, starRadius: 0.04
    },

    // Zone4Absorption
    ABS: {
      temps: [-1, -0.5, 0, 0.5, 1],
      tempNames: ['광원보다 많이 낮음', '광원보다 조금 낮음', '광원과 같음', '광원보다 조금 높음(심화)', '광원보다 많이 높음(심화)'],
      tempNotes: [
        '일직선: 기체가 흡수해 검은 선(흡수선)이 진해요',
        '일직선: 검은 선이 옅어져요',
        '일직선: 흡수한 만큼 다시 내보내 선이 거의 안 보여요',
        '일직선: 기체가 내는 빛이 더해져 밝은 선이 보여요',
        '일직선: 기체가 내는 빛이 더해져 밝은 선이 더 뚜렷해요'
      ],
      sideNotes: [
        '옆: 검은 바탕에 희미한 밝은 선(일직선의 검은 선과 같은 자리)',
        '옆: 밝은 선이 조금 더 밝아져요',
        '옆: 밝은 선이 보여요(일직선에서는 선이 사라지는 온도)',
        '옆: 밝은 선이 더 밝아요',
        '옆: 밝은 선이 가장 밝아요(방전관보다는 희미)'
      ],
      basicMaxTempIndex: 2,
      gasesBasic: ['H', 'He', 'Na'],
      gasesAdvanced: ['H', 'He', 'Na', 'Ca'],
      angleStep: 15
    },

    // Zone6Wrap
    QUIZ: {
      questions: [
        '1. 방전관 속 원소를 알아낼 수 있는 가장 확실한 근거는?',
        '2. 같은 원소의 흡수선과 방출선의 위치는?',
        '3. 별빛 스펙트럼에 흡수선이 생기는 까닭은?'
      ],
      options: [
        ['선의 위치(파장)', '선 전체의 밝기', '관의 크기'],
        ['같다', '흡수선이 항상 더 빨간 쪽', '서로 관계없다'],
        ['온도가 더 낮은 대기가 특정 파장을 흡수해서', '별의 대기가 모든 빛을 고르게 반사해서', '별빛이 먼 우주 공간을 지나며 식어서']
      ],
      explain: [
        "원소마다 선의 위치(파장)가 달라 '원소의 지문'처럼 쓸 수 있어요.",
        '같은 원소는 같은 파장의 빛을 흡수하고 내보내요. 그래서 흡수선과 방출선의 위치가 같아요.',
        '별 안쪽에서 나온 연속 스펙트럼의 빛이 그보다 온도가 낮은 별의 대기를 지나며 대기 속 원소가 특정 파장을 흡수해요.'
      ],
      // 화면 보기 순서(Options 0번이 정답)
      order: [[1, 0, 2], [2, 1, 0], [0, 2, 1]]
    },

    UNKNOWN_NAMES: ['(가)', '(나)'],
    STAR_NAMES: ['별 가', '별 나']
  };
});
