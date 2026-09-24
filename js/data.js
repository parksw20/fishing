"use strict";
// Species, baits and lures. Colours are linear RGB albedo (rendered under water, so red fades with depth).
// pref.*: how much the species likes a bait / lure (0..1). depth: preferred depth as a fraction of the water column.
// bite: 'rise' = lifts the float (classic crucian 찌올림), 'sink' = pulls the float under.
window.GameData = (function(){
  const SPECIES = [
    { id:'bungeo', name:'붕어', latin:'Carassius auratus', minLen:0.15, maxLen:0.42, wk:1.85e-5, weight:30,
      back:[0.10,0.09,0.035], belly:[0.50,0.40,0.17], pattern:6, hr:0.42,
      pref:{ paste:1.0, worm:0.7, shrimp:0.3, minnow:0.0, spoon:0.0, softworm:0.06 },
      depth:0.85, speed:0.32, power:0.75, endurance:0.8, aggr:0.4, wary:0.55, bite:'rise', rare:1.0 },
    { id:'ingeo', name:'잉어', latin:'Cyprinus carpio', minLen:0.40, maxLen:0.95, wk:1.45e-5, weight:6,
      back:[0.12,0.08,0.03], belly:[0.46,0.32,0.12], pattern:6, hr:0.33,
      pref:{ paste:0.9, worm:0.45, shrimp:0.25, minnow:0.0, spoon:0.0, softworm:0.05 },
      depth:0.85, speed:0.42, power:1.1, endurance:1.7, aggr:0.3, wary:0.75, bite:'rise', rare:1.8 },
    { id:'bluegill', name:'블루길', latin:'Lepomis macrochirus', minLen:0.10, maxLen:0.25, wk:2.6e-5, weight:26,
      back:[0.05,0.09,0.09], belly:[0.52,0.36,0.14], pattern:1, hr:0.50,
      pref:{ paste:0.45, worm:1.0, shrimp:0.7, minnow:0.2, spoon:0.3, softworm:0.5 },
      depth:0.45, speed:0.34, power:0.6, endurance:0.5, aggr:0.8, wary:0.2, bite:'sink', rare:0.8 },
    { id:'bass', name:'배스', latin:'Micropterus salmoides', minLen:0.22, maxLen:0.60, wk:1.56e-5, weight:20,
      back:[0.06,0.10,0.035], belly:[0.62,0.62,0.52], pattern:2, hr:0.29,
      pref:{ paste:0.05, worm:0.45, shrimp:0.6, minnow:1.0, spoon:0.6, softworm:0.9 },
      depth:0.5, speed:0.58, power:1.0, endurance:1.0, aggr:1.0, wary:0.35, bite:'sink', rare:1.3 },
    { id:'ssogari', name:'쏘가리', latin:'Siniperca scherzeri', minLen:0.22, maxLen:0.52, wk:1.4e-5, weight:6,
      back:[0.20,0.15,0.05], belly:[0.52,0.44,0.22], pattern:3, hr:0.28,
      pref:{ paste:0.0, worm:0.35, shrimp:0.65, minnow:0.8, spoon:0.3, softworm:0.8 },
      depth:0.8, speed:0.5, power:1.05, endurance:1.1, aggr:0.8, wary:0.55, bite:'sink', rare:2.2 },
    { id:'kkeuri', name:'끄리', latin:'Opsariichthys uncirostris', minLen:0.18, maxLen:0.40, wk:1.1e-5, weight:16,
      back:[0.05,0.09,0.13], belly:[0.72,0.68,0.66], pattern:7, hr:0.24,
      pref:{ paste:0.05, worm:0.35, shrimp:0.2, minnow:0.8, spoon:1.0, softworm:0.2 },
      depth:0.3, speed:0.8, power:0.8, endurance:0.8, aggr:0.9, wary:0.3, bite:'sink', rare:1.1 },
    { id:'megi', name:'메기', latin:'Silurus asotus', minLen:0.35, maxLen:0.85, wk:8.5e-6, weight:6,
      back:[0.05,0.05,0.04], belly:[0.38,0.36,0.30], pattern:5, hr:0.20,
      pref:{ paste:0.3, worm:0.85, shrimp:0.8, minnow:0.2, spoon:0.1, softworm:0.35 },
      depth:0.95, speed:0.34, power:1.1, endurance:1.4, aggr:0.6, wary:0.45, bite:'sink', rare:1.8 },
    { id:'songeo', name:'무지개송어', latin:'Oncorhynchus mykiss', minLen:0.28, maxLen:0.62, wk:1.2e-5, weight:8,
      back:[0.07,0.10,0.06], belly:[0.72,0.70,0.64], pattern:4, hr:0.26,
      pref:{ paste:0.1, worm:0.5, shrimp:0.3, minnow:0.7, spoon:0.9, softworm:0.3 },
      depth:0.4, speed:0.7, power:1.0, endurance:1.1, aggr:0.85, wary:0.4, bite:'sink', rare:1.6 },
  ];

  // 대낚시 (float fishing with a long pole, no reel)
  const BAITS = [
    { id:'paste',  name:'떡밥',   desc:'붕어·잉어가 좋아하는 곡물 미끼', color:[0.55,0.45,0.25], size:[0.012,0.012,0.012], kind:0, metal:0.0 },
    { id:'worm',   name:'지렁이', desc:'거의 모든 어종이 반응',         color:[0.45,0.10,0.10], size:[0.022,0.007,0.007], kind:0, metal:0.1 },
    { id:'shrimp', name:'새우',   desc:'육식성 어종(쏘가리·메기)',       color:[0.55,0.48,0.40], size:[0.018,0.008,0.008], kind:0, metal:0.2 },
  ];
  // 루어 (spinning rod with reel)
  const LURES = [
    { id:'minnow',   name:'미노우',   desc:'감으면 1m까지 잠수, 멈추면 떠오름', color:[0.10,0.35,0.15], size:[0.045,0.012,0.009], kind:1, metal:0.6,
      reel:1.05, diveDepth:1.1, idle:'float' },
    { id:'spoon',    name:'스푼',     desc:'번쩍이며 빠르게 가라앉음',         color:[0.85,0.65,0.20], size:[0.030,0.004,0.014], kind:2, metal:1.2,
      reel:1.15, diveDepth:0.6, idle:'sink' },
    { id:'softworm', name:'소프트웜', desc:'바닥을 천천히 끄는 채비',           color:[0.20,0.12,0.25], size:[0.050,0.008,0.008], kind:3, metal:0.15,
      reel:0.6, diveDepth:-1, idle:'slowsink' },
  ];

  return { SPECIES, BAITS, LURES };
})();
