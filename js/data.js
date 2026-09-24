"use strict";
// Species, baits, lures, water types and fishing regions.
// Colours are linear RGB albedo (rendered under water, so red fades with depth).
// pref.*: how much the species likes a bait / lure (0..1). depth: preferred depth as a fraction of the water column
// (capped at the visible zone). bite: 'rise' = lifts the float (classic crucian 찌올림), 'sink' = pulls it under.
window.GameData = (function(){
  const S = (o) => Object.assign({ wary:0.4, aggr:0.6, bite:'sink', rare:1, endurance:1, depth:0.5, hr:0.3, pattern:0,
    dmin:0.5, dmax:6, zone:'mid', act:{ dawn:0.7, day:0.7, dusk:0.7, night:0.5 }, retrieve:'medium', pref:{} }, o);
  // observation-only animals (whales, rays, turtles): never bite, sometimes swim past
  const V = (o) => S(Object.assign({ sight:true, wk:1e-5, pref:{}, aggr:0, wary:1, rare:3 }, o));
  const SPECIES = [
    // ---- temperate fresh water (Korea / East Asia) ----
    S({ id:'bungeo', name:'붕어', latin:'Carassius auratus', minLen:0.15, maxLen:0.42, wk:1.85e-5,
      back:[0.10,0.09,0.035], belly:[0.50,0.40,0.17], pattern:6, hr:0.42,
      pref:{ paste:1.0, worm:0.7, shrimp:0.3, minnow:0.0, spoon:0.0, softworm:0.06 },
      depth:0.85, speed:0.32, power:0.75, endurance:0.8, aggr:0.4, wary:0.55, bite:'rise', rare:1.0 }),
    S({ id:'ingeo', name:'잉어', latin:'Cyprinus carpio', minLen:0.40, maxLen:0.95, wk:1.45e-5,
      back:[0.12,0.08,0.03], belly:[0.46,0.32,0.12], pattern:6, hr:0.33,
      pref:{ paste:0.9, worm:0.45, shrimp:0.25, minnow:0.0, spoon:0.0, softworm:0.05 },
      depth:0.85, speed:0.42, power:1.1, endurance:1.7, aggr:0.3, wary:0.75, bite:'rise', rare:1.8 }),
    S({ id:'bluegill', name:'블루길', latin:'Lepomis macrochirus', minLen:0.10, maxLen:0.25, wk:2.6e-5,
      back:[0.05,0.09,0.09], belly:[0.52,0.36,0.14], pattern:1, hr:0.50,
      pref:{ paste:0.45, worm:1.0, shrimp:0.7, minnow:0.2, spoon:0.3, softworm:0.5 },
      depth:0.45, speed:0.34, power:0.6, endurance:0.5, aggr:0.8, wary:0.2, rare:0.8 }),
    S({ id:'bass', name:'배스', latin:'Micropterus salmoides', minLen:0.22, maxLen:0.62, wk:1.56e-5,
      back:[0.06,0.10,0.035], belly:[0.62,0.62,0.52], pattern:2, hr:0.29,
      pref:{ paste:0.05, worm:0.45, shrimp:0.6, minnow:1.0, spoon:0.6, softworm:0.9 },
      depth:0.5, speed:0.58, power:1.0, endurance:1.0, aggr:1.0, wary:0.35, rare:1.3 }),
    S({ id:'ssogari', name:'쏘가리', latin:'Siniperca scherzeri', minLen:0.22, maxLen:0.52, wk:1.4e-5,
      back:[0.20,0.15,0.05], belly:[0.52,0.44,0.22], pattern:3, hr:0.28,
      pref:{ paste:0.0, worm:0.35, shrimp:0.65, minnow:0.8, spoon:0.3, softworm:0.8 },
      depth:0.8, speed:0.5, power:1.05, endurance:1.1, aggr:0.8, wary:0.55, rare:2.2 }),
    S({ id:'kkeuri', name:'끄리', latin:'Opsariichthys uncirostris', minLen:0.18, maxLen:0.40, wk:1.1e-5,
      back:[0.05,0.09,0.13], belly:[0.72,0.68,0.66], pattern:7, hr:0.24,
      pref:{ paste:0.05, worm:0.35, shrimp:0.2, minnow:0.8, spoon:1.0, softworm:0.2 },
      depth:0.3, speed:0.8, power:0.8, endurance:0.8, aggr:0.9, wary:0.3, rare:1.1 }),
    S({ id:'megi', name:'메기', latin:'Silurus asotus', minLen:0.35, maxLen:0.85, wk:8.5e-6,
      back:[0.05,0.05,0.04], belly:[0.38,0.36,0.30], pattern:5, hr:0.20,
      pref:{ paste:0.3, worm:0.85, shrimp:0.8, minnow:0.2, spoon:0.1, softworm:0.35 },
      depth:0.95, speed:0.34, power:1.1, endurance:1.4, aggr:0.6, wary:0.45, rare:1.8 }),
    S({ id:'songeo', name:'무지개송어', latin:'Oncorhynchus mykiss', minLen:0.28, maxLen:0.62, wk:1.2e-5,
      back:[0.07,0.10,0.06], belly:[0.72,0.70,0.64], pattern:4, hr:0.26,
      pref:{ paste:0.1, worm:0.5, shrimp:0.3, minnow:0.7, spoon:0.9, softworm:0.3 },
      depth:0.4, speed:0.7, power:1.0, endurance:1.1, aggr:0.85, wary:0.4, rare:1.6 }),
    // ---- temperate fresh water (North America / Europe) ----
    S({ id:'pike', name:'강꼬치고기', latin:'Esox lucius', minLen:0.40, maxLen:1.10, wk:6.5e-6,
      back:[0.07,0.11,0.04], belly:[0.55,0.55,0.40], pattern:8, hr:0.18,
      pref:{ paste:0.0, worm:0.2, shrimp:0.4, minnow:1.0, spoon:0.95, softworm:0.6 },
      depth:0.45, speed:0.75, power:1.15, endurance:1.2, aggr:1.0, wary:0.3, rare:1.9 }),
    S({ id:'walleye', name:'월아이', latin:'Sander vitreus', minLen:0.30, maxLen:0.75, wk:9.5e-6,
      back:[0.16,0.13,0.05], belly:[0.62,0.60,0.50], pattern:3, hr:0.22,
      pref:{ paste:0.0, worm:0.8, shrimp:0.5, minnow:0.85, spoon:0.5, softworm:0.7 },
      depth:0.85, speed:0.5, power:0.9, endurance:1.0, aggr:0.7, wary:0.5, rare:1.5 }),
    S({ id:'chcat', name:'채널메기', latin:'Ictalurus punctatus', minLen:0.35, maxLen:0.90, wk:9.5e-6,
      back:[0.12,0.13,0.13], belly:[0.62,0.62,0.58], pattern:8, hr:0.21,
      pref:{ paste:0.5, worm:0.9, shrimp:0.8, minnow:0.15, spoon:0.1, softworm:0.3 },
      depth:0.95, speed:0.38, power:1.1, endurance:1.4, aggr:0.6, wary:0.4, rare:1.6 }),
    // ---- cold fresh water ----
    S({ id:'char', name:'북극곤들매기', latin:'Salvelinus alpinus', minLen:0.30, maxLen:0.75, wk:1.15e-5,
      back:[0.07,0.10,0.10], belly:[0.62,0.20,0.08], pattern:4, hr:0.24,
      pref:{ paste:0.05, worm:0.6, shrimp:0.5, minnow:0.8, spoon:1.0, softworm:0.4 },
      depth:0.6, speed:0.7, power:1.0, endurance:1.1, aggr:0.8, wary:0.45, rare:2.0 }),
    S({ id:'salmon', name:'왕연어', latin:'Oncorhynchus tshawytscha', minLen:0.60, maxLen:1.20, wk:1.05e-5,
      back:[0.08,0.11,0.12], belly:[0.75,0.74,0.70], pattern:8, hr:0.25,
      pref:{ paste:0.1, worm:0.4, shrimp:0.7, minnow:0.8, spoon:1.0, softworm:0.3 },
      depth:0.45, speed:0.9, power:1.3, endurance:1.8, aggr:0.7, wary:0.55, rare:2.6 }),
    // ---- tropical fresh water ----
    S({ id:'peacock', name:'피콕배스', latin:'Cichla ocellaris', minLen:0.30, maxLen:0.75, wk:1.5e-5,
      back:[0.12,0.16,0.04], belly:[0.62,0.50,0.12], pattern:1, hr:0.28,
      pref:{ paste:0.0, worm:0.3, shrimp:0.5, minnow:1.0, spoon:0.8, softworm:0.7 },
      depth:0.4, speed:0.7, power:1.2, endurance:1.2, aggr:1.0, wary:0.3, rare:1.8 }),
    S({ id:'piranha', name:'피라냐', latin:'Pygocentrus nattereri', minLen:0.15, maxLen:0.33, wk:2.9e-5,
      back:[0.10,0.11,0.11], belly:[0.40,0.40,0.38], pattern:10, hr:0.55,
      pref:{ paste:0.2, worm:0.8, shrimp:1.0, minnow:0.7, spoon:0.8, softworm:0.5 },
      depth:0.5, speed:0.6, power:0.8, endurance:0.6, aggr:1.0, wary:0.1, rare:1.2 }),
    S({ id:'arowana', name:'아로와나', latin:'Osteoglossum bicirrhosum', minLen:0.50, maxLen:1.00, wk:5.5e-6,
      back:[0.20,0.22,0.18], belly:[0.72,0.70,0.60], pattern:6, hr:0.2,
      pref:{ paste:0.0, worm:0.3, shrimp:0.6, minnow:0.8, spoon:0.5, softworm:0.5 },
      depth:0.15, speed:0.6, power:1.0, endurance:1.1, aggr:0.7, wary:0.6, rare:2.4 }),
    S({ id:'tilapia', name:'틸라피아', latin:'Oreochromis niloticus', minLen:0.15, maxLen:0.45, wk:2.2e-5,
      back:[0.10,0.11,0.09], belly:[0.50,0.48,0.42], pattern:1, hr:0.40,
      pref:{ paste:1.0, worm:0.7, shrimp:0.4, minnow:0.1, spoon:0.1, softworm:0.2 },
      depth:0.6, speed:0.35, power:0.7, endurance:0.8, aggr:0.5, wary:0.4, bite:'rise', rare:0.8 }),
    S({ id:'nileperch', name:'나일퍼치', latin:'Lates niloticus', minLen:0.50, maxLen:1.40, wk:1.2e-5,
      back:[0.16,0.16,0.13], belly:[0.70,0.68,0.60], pattern:0, hr:0.28,
      pref:{ paste:0.0, worm:0.3, shrimp:0.6, minnow:1.0, spoon:0.7, softworm:0.6 },
      depth:0.8, speed:0.6, power:1.35, endurance:1.8, aggr:0.8, wary:0.5, rare:2.8 }),
    // ---- temperate sea ----
    S({ id:'ureok', name:'조피볼락(우럭)', latin:'Sebastes schlegelii', minLen:0.20, maxLen:0.55, wk:1.8e-5,
      back:[0.10,0.09,0.07], belly:[0.40,0.38,0.34], pattern:5, hr:0.33,
      pref:{ paste:0.3, worm:0.8, shrimp:1.0, minnow:0.6, spoon:0.4, softworm:0.9 },
      depth:0.9, speed:0.35, power:0.95, endurance:1.0, aggr:0.8, wary:0.3, rare:1.1 }),
    S({ id:'gwangeo', name:'넙치(광어)', latin:'Paralichthys olivaceus', minLen:0.35, maxLen:0.85, wk:1.1e-5,
      back:[0.12,0.10,0.06], belly:[0.62,0.62,0.58], pattern:8, hr:0.42,
      pref:{ paste:0.1, worm:0.6, shrimp:0.8, minnow:0.8, spoon:0.5, softworm:1.0 },
      depth:0.98, speed:0.4, power:1.05, endurance:1.2, aggr:0.7, wary:0.45, rare:1.7 }),
    S({ id:'chamdom', name:'참돔', latin:'Pagrus major', minLen:0.25, maxLen:0.80, wk:1.9e-5,
      back:[0.55,0.18,0.14], belly:[0.72,0.55,0.50], pattern:4, hr:0.38,
      pref:{ paste:0.9, worm:0.7, shrimp:0.9, minnow:0.4, spoon:0.5, softworm:0.5 },
      depth:0.7, speed:0.55, power:1.2, endurance:1.4, aggr:0.6, wary:0.6, rare:2.2 }),
    S({ id:'nongeo', name:'농어', latin:'Lateolabrax japonicus', minLen:0.30, maxLen:0.90, wk:1.0e-5,
      back:[0.10,0.12,0.12], belly:[0.72,0.72,0.70], pattern:8, hr:0.24,
      pref:{ paste:0.05, worm:0.6, shrimp:0.7, minnow:1.0, spoon:0.8, softworm:0.6 },
      depth:0.35, speed:0.75, power:1.1, endurance:1.2, aggr:0.9, wary:0.4, rare:1.7 }),
    S({ id:'gamseong', name:'감성돔', latin:'Acanthopagrus schlegelii', minLen:0.20, maxLen:0.55, wk:2.0e-5,
      back:[0.10,0.11,0.12], belly:[0.48,0.50,0.52], pattern:1, hr:0.40,
      pref:{ paste:1.0, worm:0.6, shrimp:0.8, minnow:0.1, spoon:0.1, softworm:0.3 },
      depth:0.8, speed:0.45, power:1.05, endurance:1.2, aggr:0.4, wary:0.7, rare:1.9 }),
    S({ id:'godeungeo', name:'고등어', latin:'Scomber japonicus', minLen:0.20, maxLen:0.45, wk:1.0e-5,
      back:[0.08,0.20,0.20], belly:[0.75,0.75,0.72], pattern:9, hr:0.22,
      pref:{ paste:0.8, worm:0.6, shrimp:0.7, minnow:0.7, spoon:1.0, softworm:0.2 },
      depth:0.2, speed:0.95, power:0.8, endurance:0.8, aggr:1.0, wary:0.15, rare:0.7 }),
    // ---- tropical sea ----
    S({ id:'gt', name:'자이언트 트레발리', latin:'Caranx ignobilis', minLen:0.50, maxLen:1.40, wk:1.6e-5,
      back:[0.16,0.18,0.20], belly:[0.62,0.64,0.66], pattern:0, hr:0.36,
      pref:{ paste:0.0, worm:0.2, shrimp:0.5, minnow:1.0, spoon:0.9, softworm:0.4 },
      depth:0.3, speed:1.0, power:1.4, endurance:1.8, aggr:1.0, wary:0.3, rare:2.8 }),
    S({ id:'barracuda', name:'바라쿠다', latin:'Sphyraena barracuda', minLen:0.50, maxLen:1.30, wk:5.0e-6,
      back:[0.12,0.16,0.18], belly:[0.75,0.76,0.76], pattern:8, hr:0.14,
      pref:{ paste:0.0, worm:0.1, shrimp:0.3, minnow:1.0, spoon:1.0, softworm:0.3 },
      depth:0.25, speed:1.1, power:1.1, endurance:1.0, aggr:1.0, wary:0.3, rare:1.8 }),
    S({ id:'grouper', name:'붉바리(그루퍼)', latin:'Epinephelus akaara', minLen:0.30, maxLen:0.90, wk:1.6e-5,
      back:[0.30,0.16,0.08], belly:[0.58,0.42,0.30], pattern:8, hr:0.32,
      pref:{ paste:0.1, worm:0.5, shrimp:1.0, minnow:0.8, spoon:0.4, softworm:0.9 },
      depth:0.95, speed:0.4, power:1.25, endurance:1.3, aggr:0.8, wary:0.4, rare:2.2 }),
    S({ id:'mahi', name:'만새기(마히마히)', latin:'Coryphaena hippurus', minLen:0.50, maxLen:1.30, wk:7.0e-6,
      back:[0.05,0.28,0.18], belly:[0.62,0.58,0.12], pattern:8, hr:0.30,
      pref:{ paste:0.0, worm:0.1, shrimp:0.4, minnow:1.0, spoon:0.9, softworm:0.2 },
      depth:0.12, speed:1.1, power:1.2, endurance:1.3, aggr:0.95, wary:0.3, rare:2.1 }),
    S({ id:'parrot', name:'비늘돔', latin:'Scarus ghobban', minLen:0.25, maxLen:0.70, wk:1.8e-5,
      back:[0.04,0.32,0.28], belly:[0.20,0.55,0.50], pattern:11, hr:0.36,
      pref:{ paste:0.8, worm:0.4, shrimp:0.6, minnow:0.1, spoon:0.1, softworm:0.2 },
      depth:0.85, speed:0.4, power:0.9, endurance:1.0, aggr:0.3, wary:0.6, rare:1.4 }),
    S({ id:'snapper', name:'붉은퉁돔', latin:'Lutjanus bohar', minLen:0.30, maxLen:0.85, wk:1.7e-5,
      back:[0.45,0.12,0.10], belly:[0.65,0.40,0.36], pattern:10, hr:0.34,
      pref:{ paste:0.3, worm:0.6, shrimp:1.0, minnow:0.8, spoon:0.6, softworm:0.8 },
      depth:0.8, speed:0.55, power:1.15, endurance:1.2, aggr:0.8, wary:0.4, rare:1.7 }),
    // ---- cold sea ----
    S({ id:'cod', name:'대구', latin:'Gadus morhua', minLen:0.40, maxLen:1.20, wk:9.5e-6,
      back:[0.20,0.18,0.10], belly:[0.62,0.60,0.52], pattern:8, hr:0.24,
      pref:{ paste:0.3, worm:0.9, shrimp:0.9, minnow:0.7, spoon:0.8, softworm:0.8 },
      depth:0.9, speed:0.45, power:1.1, endurance:1.3, aggr:0.8, wary:0.3, rare:1.5 }),
    S({ id:'halibut', name:'넙치가자미(핼리벗)', latin:'Hippoglossus hippoglossus', minLen:0.50, maxLen:1.60, wk:1.0e-5,
      back:[0.12,0.11,0.08], belly:[0.62,0.62,0.60], pattern:5, hr:0.40,
      pref:{ paste:0.2, worm:0.7, shrimp:0.9, minnow:0.6, spoon:0.5, softworm:0.9 },
      depth:0.98, speed:0.45, power:1.4, endurance:2.0, aggr:0.6, wary:0.5, rare:3.0 }),
    S({ id:'pollock', name:'명태', latin:'Gadus chalcogrammus', minLen:0.30, maxLen:0.70, wk:8.0e-6,
      back:[0.14,0.13,0.10], belly:[0.66,0.64,0.60], pattern:0, hr:0.22,
      pref:{ paste:0.4, worm:0.8, shrimp:0.8, minnow:0.6, spoon:0.9, softworm:0.5 },
      depth:0.7, speed:0.55, power:0.85, endurance:0.9, aggr:0.8, wary:0.25, rare:1.0 }),
    // ---- eels, snakeheads, giants (fresh) ----
    S({ id:'eel', name:'뱀장어', latin:'Anguilla japonica', minLen:0.4, maxLen:0.8, wk:3e-6, back:[0.06,0.07,0.03], belly:[0.55,0.52,0.30], pattern:0, hr:0.07,
      shape:[0.06, 2, 0.35, 1], speed:0.35, power:0.9, endurance:1.1, aggr:0.6, wary:0.4, rare:1.6, icon:'🐍' }),
    S({ id:'snakehead', name:'가물치', latin:'Channa argus', minLen:0.4, maxLen:0.85, wk:1e-5, back:[0.10,0.10,0.05], belly:[0.45,0.42,0.30], pattern:5, hr:0.17,
      shape:[0.14, 0, 0.55, 1], speed:0.5, power:1.2, endurance:1.3, aggr:0.95, wary:0.4, rare:1.8 }),
    S({ id:'sturgeon', name:'흰철갑상어', latin:'Acipenser transmontanus', minLen:1.0, maxLen:2.5, wk:6e-6, back:[0.16,0.16,0.15], belly:[0.60,0.60,0.58], pattern:0, hr:0.14,
      shape:[0.14, 0, 0.5, 1.3], speed:0.45, power:1.4, endurance:2.4, aggr:0.4, wary:0.6, rare:3.2, icon:'🦈' }),
    S({ id:'arapaima', name:'피라루쿠', latin:'Arapaima gigas', minLen:1.2, maxLen:2.5, wk:6e-6, back:[0.14,0.16,0.10], belly:[0.50,0.30,0.18], pattern:10, hr:0.18,
      shape:[0.16, 0, 0.6, 1.1], speed:0.6, power:1.45, endurance:2.2, aggr:0.7, wary:0.7, rare:3.4, icon:'🐟' }),
    S({ id:'musky', name:'머스키', latin:'Esox masquinongy', minLen:0.7, maxLen:1.3, wk:5e-6, back:[0.14,0.16,0.08], belly:[0.58,0.56,0.44], pattern:1, hr:0.17,
      speed:0.8, power:1.3, endurance:1.5, aggr:0.9, wary:0.75, rare:3.0 }),
    // ---- sea: eels, pelagics, sharks ----
    S({ id:'conger', name:'붕장어', latin:'Conger myriaster', minLen:0.4, maxLen:0.9, wk:3e-6, back:[0.18,0.16,0.10], belly:[0.62,0.60,0.54], pattern:0, hr:0.08,
      shape:[0.07, 2, 0.35, 1], speed:0.35, power:0.95, endurance:1.1, aggr:0.7, wary:0.3, rare:1.3, icon:'🐍' }),
    S({ id:'moray', name:'자이언트 곰치', latin:'Gymnothorax javanicus', minLen:1.0, maxLen:2.2, wk:3e-6, back:[0.18,0.15,0.07], belly:[0.40,0.36,0.22], pattern:8, hr:0.10,
      shape:[0.08, 2, 0.5, 1], speed:0.35, power:1.3, endurance:1.5, aggr:0.8, wary:0.3, rare:2.2, icon:'🐍' }),
    S({ id:'bangeo', name:'방어', latin:'Seriola quinqueradiata', minLen:0.5, maxLen:1.0, wk:1.2e-5, back:[0.07,0.18,0.22], belly:[0.75,0.74,0.70], pattern:7, hr:0.26,
      speed:1.0, power:1.3, endurance:1.6, aggr:0.95, wary:0.3, rare:2.0 }),
    S({ id:'tuna', name:'참다랑어', latin:'Thunnus orientalis', minLen:0.8, maxLen:1.8, wk:2e-5, back:[0.03,0.06,0.16], belly:[0.72,0.74,0.76], pattern:0, hr:0.28,
      shape:[0.22, 0, 0.8, 1.35], speed:1.4, power:1.5, endurance:2.6, aggr:0.9, wary:0.6, rare:4.0, icon:'🐟' }),
    S({ id:'sailfish', name:'돛새치', latin:'Istiophorus platypterus', minLen:1.5, maxLen:2.5, wk:3e-6, back:[0.03,0.08,0.22], belly:[0.72,0.72,0.74], pattern:1, hr:0.16,
      shape:[0.10, 0, 3.2, 1.4], speed:1.5, power:1.4, endurance:2.0, aggr:0.9, wary:0.5, rare:4.0, icon:'🐟' }),
    S({ id:'mako', name:'청상아리', latin:'Isurus oxyrinchus', minLen:1.5, maxLen:3.0, wk:6e-6, back:[0.06,0.10,0.24], belly:[0.80,0.80,0.80], pattern:0, hr:0.20,
      shape:[0.18, 0, 1.7, 1.5], speed:1.3, power:1.6, endurance:2.4, aggr:1.0, wary:0.3, rare:4.5, icon:'🦈' }),
    S({ id:'blacktip', name:'흑기흉상어', latin:'Carcharhinus limbatus', minLen:1.2, maxLen:1.9, wk:6e-6, back:[0.20,0.19,0.15], belly:[0.78,0.78,0.76], pattern:0, hr:0.19,
      shape:[0.17, 0, 1.6, 1.4], speed:1.1, power:1.4, endurance:1.8, aggr:0.95, wary:0.3, rare:3.2, icon:'🦈' }),
    S({ id:'hammerhead', name:'귀상어', latin:'Sphyrna lewini', minLen:1.8, maxLen:3.2, wk:5e-6, back:[0.26,0.26,0.22], belly:[0.78,0.78,0.76], pattern:0, hr:0.18,
      shape:[0.22, 0, 2.2, 1.5], speed:1.0, power:1.6, endurance:2.4, aggr:0.8, wary:0.5, rare:4.8, icon:'🦈', sightCoins:500 }),
    S({ id:'mola', name:'개복치', latin:'Mola mola', minLen:1.0, maxLen:2.5, wk:6e-5, back:[0.30,0.32,0.34], belly:[0.70,0.70,0.72], pattern:0, hr:1.0,
      shape:[0.22, 3, 2.2, 1], speed:0.45, power:1.5, endurance:2.5, aggr:0.1, wary:0.8, rare:6.0, icon:'🐡', sightCoins:600 }),
    // ---- observation only ----
    V({ id:'whaleshark', name:'고래상어', latin:'Rhincodon typus', minLen:5, maxLen:10, back:[0.07,0.10,0.14], belly:[0.72,0.72,0.70], pattern:12, hr:0.22,
      shape:[0.26, 0, 1.2, 1.3], speed:1.0, icon:'🦈', sightCoins:900 }),
    V({ id:'manta', name:'대왕쥐가오리', latin:'Mobula birostris', minLen:2.2, maxLen:3.5, back:[0.03,0.03,0.04], belly:[0.80,0.80,0.80], pattern:0, hr:0.14,
      shape:[1.9, 2, 0, 1], speed:1.0, icon:'🦅', sightCoins:800 }),
    V({ id:'turtle', name:'푸른바다거북', latin:'Chelonia mydas', minLen:0.8, maxLen:1.2, back:[0.20,0.18,0.08], belly:[0.62,0.58,0.40], pattern:6, hr:0.32,
      shape:[0.8, 2, 0, 1], speed:0.6, icon:'🐢', sightCoins:500 }),
    V({ id:'dolphin', name:'남방큰돌고래', latin:'Tursiops aduncus', minLen:2.0, maxLen:2.6, back:[0.22,0.24,0.27], belly:[0.72,0.72,0.72], pattern:0, hr:0.2,
      shape:[0.2, 1, 1.3, 1.1], speed:3.0, icon:'🐬', sightCoins:500 }),
    V({ id:'humpback', name:'혹등고래', latin:'Megaptera novaeangliae', minLen:11, maxLen:15, back:[0.08,0.09,0.10], belly:[0.55,0.56,0.58], pattern:0, hr:0.22,
      shape:[0.25, 1, 0.3, 1.1], speed:2.0, icon:'🐋', sightCoins:1500 }),
    V({ id:'orca', name:'범고래', latin:'Orcinus orca', minLen:6, maxLen:8, back:[0.02,0.02,0.02], belly:[0.85,0.85,0.85], pattern:0, hr:0.22,
      shape:[0.22, 1, 2.6, 1.1], speed:2.5, icon:'🐋', sightCoins:1200 }),
  ];
  // merge the researched angling ecology (depth band, feeding times, bait/lure ranking, sizes, tips)
  for (const sp of SPECIES){
    const e = (window.ECOLOGY || {})[sp.id]; if (!e) continue;
    if (e.sight){ sp.dmin = e.dmin; sp.dmax = Math.max(e.dmax, e.dmin + 2); sp.nearBoats = e.nearBoats; }
    else {
      Object.assign(sp, { dmin: e.dmin, dmax: e.dmax, zone: e.zone, act: e.act, retrieve: e.retrieve, retrieveNote: e.retrieveNote, feeding: e.feeding, structure: e.structure, tip: e.tip, pref: e.pref });
      if (e.lenCm && e.kg){ sp.minLen = e.lenCm[0]/100; sp.maxLen = e.lenCm[1]/100*1.15; sp.wk = e.kg[1]/Math.pow(e.lenCm[1], 3); }
    }
    sp.sources = e.sources; sp.verified = e.verified;
  }
  const BY_ID = Object.fromEntries(SPECIES.map(s => [s.id, s]));

  // fish communities: [species id, spawn weight]
  const BIOMES = {
    kr_fresh:   { name:'온대 민물', water:'fresh', fish:[['bungeo',30],['ingeo',6],['bluegill',26],['bass',20],['ssogari',6],['kkeuri',16],['megi',6],['songeo',8],['eel',8],['snakehead',7]], visitors:[] },
    na_fresh:   { name:'온대 민물', water:'fresh', fish:[['bass',28],['bluegill',26],['pike',12],['walleye',12],['chcat',10],['songeo',10],['ingeo',6],['musky',2]], visitors:[['musky',0.05],['sturgeon',0.03]] },
    cold_fresh: { name:'한대 민물', water:'fresh', fish:[['songeo',26],['char',16],['pike',18],['salmon',10],['walleye',12],['sturgeon',2]], visitors:[['sturgeon',0.06]] },
    trop_fresh: { name:'열대 민물', water:'fresh', fish:[['peacock',18],['piranha',26],['arowana',8],['tilapia',26],['nileperch',6],['chcat',6],['arapaima',2]], visitors:[['arapaima',0.08]] },
    temp_sea:   { name:'온대 바다', water:'salt',  fish:[['ureok',26],['gwangeo',12],['chamdom',8],['nongeo',12],['gamseong',12],['godeungeo',30],['conger',10],['bangeo',7],['tuna',1],['mako',0.6],['mola',0.4]], visitors:[['dolphin',0.04],['mola',0.035],['mako',0.02],['humpback',0.012]] },
    trop_sea:   { name:'열대 바다', water:'salt',  fish:[['gt',8],['barracuda',14],['grouper',14],['mahi',10],['parrot',24],['snapper',20],['moray',7],['blacktip',5],['tuna',2],['sailfish',1.5],['hammerhead',0.6]], visitors:[['turtle',0.05],['manta',0.035],['whaleshark',0.025],['dolphin',0.03],['hammerhead',0.025],['sailfish',0.02]] },
    cold_sea:   { name:'한대 바다', water:'salt',  fish:[['cod',28],['halibut',8],['pollock',30],['godeungeo',16],['salmon',8]], visitors:[['humpback',0.05],['orca',0.035],['dolphin',0.02]] },
  };

  // water look and bathymetry: sigA/sigS = absorption/scattering (1/m); depth = [base, amp, min, max]; scale = 1/feature size
  const WATERS = {
    lake_clear: { name:'맑은 호수', sigA:[0.40,0.074,0.088], sigS:[0.028,0.052,0.068], depth:[4.5,7,1.4,12],   scale:0.018, bed:[0.1,1,1,1],        land:1.0 },
    lake_green: { name:'녹색 호수', sigA:[0.45,0.11,0.22],   sigS:[0.035,0.07,0.045], depth:[4,5,1.2,9],   scale:0.02,  bed:[0.4,0.75,0.8,0.6], land:1.0 },
    river_brown:{ name:'열대 강',   sigA:[0.36,0.30,0.48],   sigS:[0.07,0.055,0.03],  depth:[4,4,1.2,9], scale:0.025, bed:[0.8,0.6,0.5,0.4], land:1.2 },
    cold_lake:  { name:'빙하 호수', sigA:[0.42,0.07,0.05],   sigS:[0.02,0.045,0.05],  depth:[10,16,1.5,30],  scale:0.015, bed:[0.0,0.85,0.9,0.95],land:1.4 },
    sea_temp:   { name:'온대 바다', sigA:[0.42,0.058,0.035], sigS:[0.012,0.026,0.04], depth:[13,22,1.6,40],scale:0.012, bed:[0.4,1,0.95,0.85], land:0.7 },
    sea_trop:   { name:'열대 바다', sigA:[0.40,0.042,0.016], sigS:[0.006,0.02,0.045], depth:[11,26,1.3,45],scale:0.014, bed:[1.0,1.2,1.15,1.0], land:0.35 },
    sea_cold:   { name:'한대 바다', sigA:[0.43,0.075,0.055], sigS:[0.02,0.04,0.045],  depth:[16,26,2.0,50],scale:0.01,  bed:[0.0,0.8,0.85,0.9], land:1.1 },
  };

  // preset spots on the world map (lat, lon)
  const SPOTS = [
    { id:'soyang',   name:'소양호',            country:'대한민국', lat:37.95, lon:127.85, biome:'kr_fresh',  water:'lake_clear', start:2.6 , relief:650, shore:1.6 },
    { id:'jeju',     name:'제주 서귀포 앞바다', country:'대한민국', lat:33.20, lon:126.55, biome:'temp_sea',  water:'sea_temp',   start:4 , relief:900 },
    { id:'ulleung',  name:'울릉도',            country:'대한민국', lat:37.50, lon:130.90, biome:'temp_sea',  water:'sea_temp',   start:6 , relief:900 },
    { id:'biwa',     name:'비와호',            country:'일본',     lat:35.25, lon:136.10, biome:'kr_fresh',  water:'lake_green', start:3 , relief:800, shore:7 },
    { id:'corsica',  name:'코르시카',          country:'프랑스',   lat:41.85, lon:8.62,   biome:'temp_sea',  water:'sea_temp',   start:2.4 , relief:1500 },
    { id:'lofoten',  name:'로포텐 제도',       country:'노르웨이', lat:68.20, lon:14.50,  biome:'cold_sea',  water:'sea_cold',   start:6 , relief:900 },
    { id:'kenai',    name:'케나이 호',         country:'미국 알래스카', lat:60.45, lon:-150.2, biome:'cold_fresh', water:'cold_lake', start:3 , relief:1300, shore:4 },
    { id:'ontario',  name:'온타리오 호',       country:'캐나다',   lat:43.70, lon:-77.90, biome:'na_fresh',  water:'lake_clear', start:3 , relief:90, shore:25 },
    { id:'okeechobee', name:'오키초비 호',     country:'미국 플로리다', lat:26.95, lon:-80.80, biome:'na_fresh', water:'lake_green', start:2.2 , relief:15, shore:12 },
    { id:'kona',     name:'코나 앞바다',       country:'미국 하와이', lat:19.60, lon:-156.10, biome:'trop_sea', water:'sea_trop', start:5 , relief:1800 },
    { id:'maldives', name:'몰디브 환초',       country:'몰디브',   lat:4.20,  lon:73.50,  biome:'trop_sea',  water:'sea_trop',   start:2 , relief:4 },
    { id:'gbr',      name:'그레이트배리어리프', country:'호주',    lat:-18.30, lon:147.70, biome:'trop_sea', water:'sea_trop',  start:2.5 , relief:60 },
    { id:'amazon',   name:'아마존 강',         country:'브라질',   lat:-3.10, lon:-60.00, biome:'trop_fresh', water:'river_brown', start:3 , relief:35, shore:1.2 },
    { id:'victoria', name:'빅토리아 호',       country:'우간다',   lat:-0.50, lon:33.00,  biome:'trop_fresh', water:'lake_green', start:3 , relief:150, shore:20 },
    { id:'patagonia', name:'나우엘우아피 호',  country:'아르헨티나', lat:-41.10, lon:-71.40, biome:'cold_fresh', water:'cold_lake', start:3 , relief:1600, shore:5 },
  ];

  // 대낚시 (float fishing with a long pole, no reel); sea names in nameSea
  const BAITS = [
    { id:'paste',  name:'떡밥',   nameSea:'크릴',      desc:'붕어·잉어·감성돔이 좋아하는 밑밥 미끼', color:[0.55,0.45,0.25], size:[0.012,0.012,0.012], kind:0, metal:0.0 },
    { id:'worm',   name:'지렁이', nameSea:'청갯지렁이', desc:'거의 모든 어종이 반응',               color:[0.45,0.10,0.10], size:[0.022,0.007,0.007], kind:0, metal:0.1 },
    { id:'shrimp', name:'새우',   nameSea:'오징어살',  desc:'육식성 어종이 좋아함',                color:[0.55,0.48,0.40], size:[0.018,0.008,0.008], kind:0, metal:0.2 },
    { id:'cutbait', name:'생선 토막', desc:'메기·상어·대구·핼리벗 — 냄새로 큰 고기를 부름', color:[0.62,0.38,0.34], size:[0.03,0.012,0.02], kind:0, metal:0.3, cost:250 },
    { id:'livebait', name:'살아있는 미끼', desc:'미꾸라지·전갱이 — 대형 육식어의 1순위', color:[0.35,0.40,0.42], size:[0.045,0.01,0.008], kind:1, metal:0.7, cost:450 },
  ];
  // 루어 (spinning rod with reel)
  const LURES = [
    { id:'minnow',   name:'미노우',   desc:'감으면 1m까지 잠수, 멈추면 떠오름', color:[0.10,0.35,0.15], size:[0.045,0.012,0.009], kind:1, metal:0.6,
      reel:1.05, diveDepth:1.1, idle:'float' },
    { id:'spoon',    name:'스푼',     desc:'번쩍이며 빠르게 가라앉음',         color:[0.85,0.65,0.20], size:[0.030,0.004,0.014], kind:2, metal:1.2,
      reel:1.15, diveDepth:0.6, idle:'sink' },
    { id:'softworm', name:'소프트웜', desc:'바닥을 천천히 끄는 채비',           color:[0.20,0.12,0.25], size:[0.050,0.008,0.008], kind:3, metal:0.15,
      reel:0.6, diveDepth:-1, idle:'slowsink' },
    { id:'topwater', name:'포퍼', desc:'수면에서 물보라를 일으킴 — 가물치·GT·배스(새벽)', color:[0.90,0.85,0.20], size:[0.04,0.015,0.012], kind:1, metal:0.4,
      reel:0.9, diveDepth:0, idle:'surface', cost:350 },
    { id:'jig', name:'메탈지그', desc:'빠르게 바닥까지 — 감으면 솟구침 (참돔·방어·대구)', color:[0.55,0.62,0.80], size:[0.04,0.006,0.012], kind:2, metal:1.4,
      reel:1.3, diveDepth:1.6, idle:'fastsink', cost:500 },
    { id:'trolling', name:'빅게임 루어', desc:'대형 트롤링 루어 — 다랑어·돛새치·청상아리', color:[0.85,0.25,0.55], size:[0.09,0.022,0.018], kind:1, metal:0.8,
      reel:1.6, diveDepth:2.5, idle:'float', cost:1200 },
  ];
  // equipment upgrades
  const SHOP = [
    { id:'rod', name:'낚싯대', icon:'🎣', tiers:[
      { name:'기본 낚싯대', cost:0, cast:1, absorb:1, desc:'기본 캐스팅 거리' },
      { name:'카본 로드', cost:600, cast:1.2, absorb:0.9, desc:'캐스팅 +20% · 파이팅 장력 -10%' },
      { name:'빅게임 로드', cost:2400, cast:1.4, absorb:0.8, desc:'캐스팅 +40% · 파이팅 장력 -20%' } ] },
    { id:'reel', name:'릴', icon:'🌀', tiers:[
      { name:'기본 스피닝 릴', cost:0, speed:1, desc:'기본 감기 속도' },
      { name:'고기어 릴', cost:500, speed:1.3, desc:'감기 속도 +30%' },
      { name:'전동 릴', cost:1800, speed:1.6, desc:'감기 속도 +60%' } ] },
    { id:'line', name:'원줄', icon:'🧵', tiers:[
      { name:'나일론', cost:0, mult:1, desc:'기본 강도' },
      { name:'카본', cost:400, mult:1.5, desc:'강도 ×1.5 (예민한 어종은 입질이 조금 줄어듦)' },
      { name:'PE 합사', cost:1200, mult:2.2, desc:'강도 ×2.2 (예민한 어종 입질 감소)' },
      { name:'빅게임 PE', cost:3500, mult:3.2, desc:'강도 ×3.2 — 상어·다랑어용' } ] },
    { id:'hook', name:'바늘', icon:'🪝', tiers:[
      { name:'기본 바늘', cost:0, hold:1, window:1, desc:'기본 걸림' },
      { name:'예리한 바늘', cost:300, hold:0.6, window:1.3, desc:'챔질 여유 +30% · 바늘 빠짐 -40%' },
      { name:'서클훅', cost:1000, hold:0.3, window:1.6, desc:'챔질 여유 +60% · 바늘 빠짐 -70%' } ] },
    { id:'sonar', name:'어탐기', icon:'📡', tiers:[
      { name:'기본 어탐기', cost:0, desc:'수심과 어군 표시' },
      { name:'컬러 어탐기', cost:500, desc:'물고기 크기별 색 구분' },
      { name:'스캔 어탐기', cost:1500, desc:'발밑 가장 큰 물고기의 어종 표시' } ] },
    { id:'engine', name:'엔진', icon:'⚙️', tiers:[
      { name:'5마력 선외기', cost:0, speed:8, desc:'최고 15노트' },
      { name:'15마력 선외기', cost:700, speed:11, desc:'최고 21노트' },
      { name:'40마력 선외기', cost:2200, speed:15, desc:'최고 29노트' } ] },
  ];

  return { SPECIES, BY_ID, BIOMES, WATERS, SPOTS, BAITS, LURES, SHOP };
})();
