"use strict";
// Angling ecology per species, compiled from FishBase, takemefishing.org, US state fishing guides (MN/MO DNR, FWC, ODFW),
// NOAA, Australian Museum, 낚시춘추 and other angling sources (see `sources`; verified:false = general angling knowledge).
// pref: 1.0 = the first choice anglers use, falling by rank; baits/lures anglers do not use for the species get ~0.02-0.03.
window.ECOLOGY = {
"bungeo": {
"dmin": 0.5,
"dmax": 4,
"zone": "bottom",
"act": {
"dawn": 0.9,
"day": 0.4,
"dusk": 0.8,
"night": 0.6
},
"pref": {
"paste": 1.0,
"worm": 0.75,
"shrimp": 0.03,
"cutbait": 0.03,
"livebait": 0.03,
"minnow": 0.02,
"spoon": 0.02,
"softworm": 0.15,
"topwater": 0.02,
"jig": 0.02,
"trolling": 0.02
},
"retrieve": "slow",
"retrieveNote": "lures rarely used; stationary float-fishing bait on bottom",
"feeding": "grazing/foraging omnivore: sucks grain, detritus, small invertebrates off bottom",
"structure": [
"weed",
"mud",
"reed edges"
],
"lenCm": [
15,
40
],
"kg": [
0.1,
1.2
],
"tip": "새벽 첫 입질 시간, 수초 언저리 1~2m 수심에 떡밥·글루텐 바닥낚시",
"sources": [
"https://m.fishingseasons.co.kr/news_Detail.asp?b_no=12069",
"https://fishquest.yatnll.com/entry/%EB%B6%95%EC%96%B4%EB%82%9A%EC%8B%9C-%ED%8F%AC%EC%9D%B8%ED%8A%B8%EB%B3%B4%EB%8B%A4-%EC%A4%91%EC%9A%94%ED%95%9C-%EC%8B%9C%EA%B0%84%EB%8C%80%EC%99%80-%EB%AF%B8%EB%81%BC-%EC%A1%B0%ED%95%A9-%EB%B9%84%EB%B2%95"
],
"verified": true
},
"ingeo": {
"dmin": 1,
"dmax": 5,
"zone": "bottom",
"act": {
"dawn": 0.8,
"day": 0.5,
"dusk": 0.8,
"night": 0.7
},
"pref": {
"paste": 1.0,
"worm": 0.75,
"shrimp": 0.03,
"cutbait": 0.03,
"livebait": 0.03,
"minnow": 0.02,
"spoon": 0.02,
"softworm": 0.15,
"topwater": 0.02,
"jig": 0.02,
"trolling": 0.02
},
"retrieve": "slow",
"retrieveNote": "bait fishing dominant; lures almost never",
"feeding": "bottom-rooting omnivore (grazing/sucking mud for invertebrates, grain)",
"structure": [
"mud",
"weed",
"slow current"
],
"lenCm": [
40,
80
],
"kg": [
1,
10
],
"tip": "밤·새벽 진흙바닥에 옥수수·보리 떡밥을 집어해 기다리는 바닥 릴낚시",
"sources": [
"general knowledge"
],
"verified": false
},
"bluegill": {
"dmin": 0.5,
"dmax": 4,
"zone": "mid",
"act": {
"dawn": 0.7,
"day": 0.8,
"dusk": 0.7,
"night": 0.2
},
"pref": {
"paste": 0.75,
"worm": 1.0,
"shrimp": 0.03,
"cutbait": 0.03,
"livebait": 0.03,
"minnow": 0.02,
"spoon": 0.75,
"softworm": 1.0,
"topwater": 0.55,
"jig": 0.02,
"trolling": 0.02
},
"retrieve": "slow",
"retrieveNote": "small jig under float, slow drop",
"feeding": "opportunistic picker of insects/small invertebrates; schools near cover",
"structure": [
"weed",
"docks",
"shallow flats"
],
"lenCm": [
10,
22
],
"kg": [
0.05,
0.4
],
"tip": "낮에 연안 수초·잔교 주변에 작은 지렁이 찌낚시",
"sources": [
"general knowledge"
],
"verified": false
},
"bass": {
"dmin": 0.5,
"dmax": 6,
"zone": "mid",
"act": {
"dawn": 0.9,
"day": 0.5,
"dusk": 0.9,
"night": 0.4
},
"pref": {
"paste": 0.03,
"worm": 0.55,
"shrimp": 0.75,
"cutbait": 0.03,
"livebait": 1.0,
"minnow": 0.55,
"spoon": 0.4,
"softworm": 1.0,
"topwater": 0.75,
"jig": 0.3,
"trolling": 0.02
},
"retrieve": "medium",
"retrieveNote": "slow drag/shake for softworm, stop-and-go for minnows; topwater at low light",
"feeding": "ambush predator from cover; eats fish, crayfish, frogs",
"structure": [
"weed",
"rock",
"wood/brush",
"drop-offs"
],
"lenCm": [
25,
50
],
"kg": [
0.3,
3
],
"tip": "해질녘 수초 주변에서 느린 소프트웜 바닥 끌기, 새벽엔 탑워터",
"sources": [
"general knowledge"
],
"verified": false
},
"ssogari": {
"dmin": 0.5,
"dmax": 5,
"zone": "bottom",
"act": {
"dawn": 0.8,
"day": 0.3,
"dusk": 0.9,
"night": 1.0
},
"pref": {
"paste": 0.03,
"worm": 0.55,
"shrimp": 0.75,
"cutbait": 0.03,
"livebait": 1.0,
"minnow": 0.75,
"spoon": 0.55,
"softworm": 1.0,
"topwater": 0.02,
"jig": 0.02,
"trolling": 0.02
},
"retrieve": "slow",
"retrieveNote": "drag or swim grub 30-50cm off rocky bottom; at night shallow near shore; dark colors at night",
"feeding": "nocturnal ambush predator among rocks in current; eats small fish and shrimp",
"structure": [
"rock",
"current(여울)",
"boulder"
],
"lenCm": [
20,
45
],
"kg": [
0.2,
1.5
],
"tip": "밤에 여울 옆 바위 지대를 어두운 색 그럽 웜으로 바닥 위 30~50cm 띄워 천천히 감기",
"sources": [
"https://m.fishingseasons.co.kr/news_Detail.asp?b_no=464",
"https://m.fishingseasons.co.kr/news_Detail.asp?b_no=3900"
],
"verified": true
},
"kkeuri": {
"dmin": 0.3,
"dmax": 3,
"zone": "top",
"act": {
"dawn": 0.9,
"day": 0.7,
"dusk": 0.9,
"night": 0.2
},
"pref": {
"paste": 0.03,
"worm": 0.75,
"shrimp": 0.03,
"cutbait": 0.03,
"livebait": 1.0,
"minnow": 0.75,
"spoon": 1.0,
"softworm": 0.02,
"topwater": 0.02,
"jig": 0.02,
"trolling": 0.02
},
"retrieve": "fast",
"retrieveNote": "fast retrieve with twitch/jerk; pause when passing obstacles",
"feeding": "fast pursuit predator of small fish (피라미) in riffles, often schooling",
"structure": [
"current(여울)",
"gravel",
"open water"
],
"lenCm": [
20,
35
],
"kg": [
0.1,
0.5
],
"tip": "여울 시작 지점과 하류에 5~8g 스푼을 빠르게 감다 트위칭",
"sources": [
"https://fishingvillage.co.kr/%EB%81%84%EB%A6%AC-%EB%82%9A%EC%8B%9C-%EC%A4%80%EB%B9%84%EB%AC%BC-%EB%82%9A%EC%8B%9C-%EB%B0%A9%EB%B2%95-%EC%A3%BC%EC%9D%98%EC%82%AC%ED%95%AD/"
],
"verified": true
},
"megi": {
"dmin": 0.5,
"dmax": 5,
"zone": "bottom",
"act": {
"dawn": 0.5,
"day": 0.2,
"dusk": 0.9,
"night": 1.0
},
"pref": {
"paste": 0.03,
"worm": 1.0,
"shrimp": 0.03,
"cutbait": 0.55,
"livebait": 0.75,
"minnow": 0.02,
"spoon": 1.0,
"softworm": 0.75,
"topwater": 0.02,
"jig": 0.02,
"trolling": 0.02
},
"retrieve": "slow",
"retrieveNote": "slow grub/spoon near bottom; gold/fluorescent/black in murky water",
"feeding": "nocturnal ambush/scavenging predator using barbels; active in muddy water after rain",
"structure": [
"mud",
"deep pools",
"current seams"
],
"lenCm": [
30,
60
],
"kg": [
0.5,
3
],
"tip": "해진 직후~밤 10시, 장마 흙탕물 때 깊은 소에 지렁이·미꾸라지 바닥낚시",
"sources": [
"https://m.fishingseasons.co.kr/news_Detail.asp?b_no=3901",
"https://fishingvillage.co.kr/%EB%A9%94%EA%B8%B0-%EB%82%9A%EC%8B%9C-%EC%A4%80%EB%B9%84%EB%AC%BC-%EB%82%9A%EC%8B%9C-%EB%B0%A9%EB%B2%95-%EC%A3%BC%EC%9D%98%EC%82%AC%ED%95%AD/"
],
"verified": true
},
"songeo": {
"dmin": 0.5,
"dmax": 5,
"zone": "mid",
"act": {
"dawn": 0.9,
"day": 0.5,
"dusk": 0.8,
"night": 0.2
},
"pref": {
"paste": 0.75,
"worm": 1.0,
"shrimp": 0.55,
"cutbait": 0.03,
"livebait": 0.03,
"minnow": 0.75,
"spoon": 1.0,
"softworm": 0.02,
"topwater": 0.02,
"jig": 0.02,
"trolling": 0.02
},
"retrieve": "medium",
"retrieveNote": "steady retrieve with occasional flutter; cold water slower",
"feeding": "drift-feeding/pursuit of insects and small fish; cold clear water",
"structure": [
"current",
"cold clear water",
"pool tail"
],
"lenCm": [
25,
50
],
"kg": [
0.3,
2
],
"tip": "이른 아침 찬 물 유입구 근처에 소형 스푼을 일정 속도로 감기",
"sources": [
"general knowledge"
],
"verified": false
},
"pike": {
"dmin": 1,
"dmax": 6,
"zone": "mid",
"act": {
"dawn": 0.8,
"day": 0.8,
"dusk": 0.7,
"night": 0.1
},
"pref": {
"paste": 0.03,
"worm": 0.03,
"shrimp": 0.03,
"cutbait": 0.75,
"livebait": 1.0,
"minnow": 0.75,
"spoon": 1.0,
"softworm": 0.55,
"topwater": 0.4,
"jig": 0.02,
"trolling": 0.02
},
"retrieve": "medium",
"retrieveNote": "erratic spoon/jerkbait with pauses along weed edge",
"feeding": "ambush predator from weed edges; daytime sight feeder",
"structure": [
"weed",
"shallow bays",
"drop-offs"
],
"lenCm": [
50,
90
],
"kg": [
1.5,
8
],
"tip": "낮에 수초대 가장자리를 스푼·저크베이트로 불규칙하게 끌기",
"sources": [
"general knowledge"
],
"verified": false
},
"walleye": {
"dmin": 2,
"dmax": 8,
"zone": "bottom",
"act": {
"dawn": 0.9,
"day": 0.2,
"dusk": 1.0,
"night": 0.8
},
"pref": {
"paste": 0.03,
"worm": 0.75,
"shrimp": 0.03,
"cutbait": 0.03,
"livebait": 1.0,
"minnow": 0.75,
"spoon": 0.02,
"softworm": 0.02,
"topwater": 0.02,
"jig": 1.0,
"trolling": 0.55
},
"retrieve": "slow",
"retrieveNote": "jig hopped near bottom; slow troll crankbaits at night in 2-6m",
"feeding": "low-light ambush/pursuit predator of baitfish (photosensitive eyes)",
"structure": [
"rock",
"gravel",
"weed edges",
"drop-offs"
],
"lenCm": [
35,
60
],
"kg": [
0.5,
3.5
],
"tip": "해질녘~밤 3~6m 수초·자갈 턱에 미노우 끼운 지그를 천천히 바닥 튕기기",
"sources": [
"https://www.takemefishing.org/how-to-fish/fishing-tips/how-to-catch-walleye-at-night/",
"https://www.dnr.state.mn.us/gofishing/how-catch-walleye.html"
],
"verified": true
},
"chcat": {
"dmin": 1,
"dmax": 6,
"zone": "bottom",
"act": {
"dawn": 0.5,
"day": 0.3,
"dusk": 0.9,
"night": 1.0
},
"pref": {
"paste": 0.03,
"worm": 0.75,
"shrimp": 0.55,
"cutbait": 1.0,
"livebait": 0.03,
"minnow": 0.02,
"spoon": 0.02,
"softworm": 0.75,
"topwater": 0.02,
"jig": 1.0,
"trolling": 0.02
},
"retrieve": "slow",
"retrieveNote": "static bait on bottom with minimal weight",
"feeding": "scavenging/foraging by smell and taste; mostly nocturnal",
"structure": [
"mud",
"wood/brush",
"current seams",
"rock piles"
],
"lenCm": [
35,
65
],
"kg": [
0.7,
5
],
"tip": "늦은 오후~밤 쓰러진 나무 옆 바닥에 생선 토막·닭간 원투",
"sources": [
"https://www.dnr.state.mn.us/gofishing/how-catch-channel-catfish.html",
"https://mdc.mo.gov/fishing/species/catfish/catfish-tips-fishing"
],
"verified": true
},
"char": {
"dmin": 2,
"dmax": 20,
"zone": "mid",
"act": {
"dawn": 0.8,
"day": 0.6,
"dusk": 0.8,
"night": 0.3
},
"pref": {
"paste": 0.03,
"worm": 1.0,
"shrimp": 0.75,
"cutbait": 0.03,
"livebait": 0.55,
"minnow": 0.02,
"spoon": 1.0,
"softworm": 0.02,
"topwater": 0.02,
"jig": 0.75,
"trolling": 0.02
},
"retrieve": "medium",
"retrieveNote": "small spoon with flutter; jigging through ice",
"feeding": "pursuit of small fish, zooplankton and insects in cold lakes/rivers",
"structure": [
"cold clear water",
"gravel",
"river mouths"
],
"lenCm": [
35,
70
],
"kg": [
1,
5
],
"tip": "차가운 호수 하구에 작은 반짝이 스푼을 팔랑이게 감기",
"sources": [
"general knowledge"
],
"verified": false
},
"salmon": {
"dmin": 3,
"dmax": 40,
"zone": "mid",
"act": {
"dawn": 0.9,
"day": 0.5,
"dusk": 0.7,
"night": 0.1
},
"pref": {
"paste": 0.03,
"worm": 0.03,
"shrimp": 0.03,
"cutbait": 1.0,
"livebait": 0.75,
"minnow": 0.02,
"spoon": 0.75,
"softworm": 0.02,
"topwater": 0.02,
"jig": 0.55,
"trolling": 1.0
},
"retrieve": "medium",
"retrieveNote": "troll 2-4 km/h with flasher; river: drift/swing",
"feeding": "pursuit predator of herring/anchovy at sea; in rivers mostly reaction strikes",
"structure": [
"current",
"open water",
"river mouths"
],
"lenCm": [
60,
100
],
"kg": [
5,
18
],
"tip": "새벽 하구 조류대에서 청어 미끼·플래셔로 트롤링",
"sources": [
"general knowledge"
],
"verified": false
},
"peacock": {
"dmin": 0.5,
"dmax": 4,
"zone": "top",
"act": {
"dawn": 0.9,
"day": 0.8,
"dusk": 0.8,
"night": 0.05
},
"pref": {
"paste": 0.03,
"worm": 0.03,
"shrimp": 0.03,
"cutbait": 0.03,
"livebait": 1.0,
"minnow": 0.75,
"spoon": 0.55,
"softworm": 0.4,
"topwater": 1.0,
"jig": 0.02,
"trolling": 0.02
},
"retrieve": "fast",
"retrieveNote": "faster than for largemouth; loud topwater; pauses less",
"feeding": "aggressive diurnal pursuit/ambush predator; inactive at night",
"structure": [
"wood/brush",
"rock",
"lagoon edges",
"shallow flats"
],
"lenCm": [
35,
65
],
"kg": [
1,
6
],
"tip": "해뜬 뒤 2~3시간 얕은 라군에서 프롭 탑워터를 빠르게 감기",
"sources": [
"https://myfwc.com/fishing/freshwater/fishing-tips/butterfly-peacock-bass/",
"https://www.howtocatchanyfish.com/peacock-bass"
],
"verified": true
},
"piranha": {
"dmin": 0.5,
"dmax": 4,
"zone": "mid",
"act": {
"dawn": 0.8,
"day": 0.7,
"dusk": 0.8,
"night": 0.4
},
"pref": {
"paste": 0.03,
"worm": 0.03,
"shrimp": 0.03,
"cutbait": 1.0,
"livebait": 0.75,
"minnow": 0.02,
"spoon": 1.0,
"softworm": 0.02,
"topwater": 0.02,
"jig": 0.75,
"trolling": 0.02
},
"retrieve": "medium",
"retrieveNote": "splash rod tip to attract, wire leader",
"feeding": "schooling scavenger/opportunistic biter attracted by blood and splashing",
"structure": [
"slow current",
"flooded forest",
"weed"
],
"lenCm": [
15,
30
],
"kg": [
0.3,
1.5
],
"tip": "물을 쳐서 모은 뒤 핏기 있는 생선 토막을 철사 목줄로",
"sources": [
"general knowledge"
],
"verified": false
},
"arowana": {
"dmin": 0,
"dmax": 1.5,
"zone": "top",
"act": {
"dawn": 0.9,
"day": 0.6,
"dusk": 0.8,
"night": 0.3
},
"pref": {
"paste": 0.03,
"worm": 1.0,
"shrimp": 0.03,
"cutbait": 0.03,
"livebait": 0.75,
"minnow": 1.0,
"spoon": 0.02,
"softworm": 0.02,
"topwater": 0.55,
"jig": 0.02,
"trolling": 0.02
},
"retrieve": "medium",
"retrieveNote": "twitch on surface near overhanging trees; hard mouth, many misses",
"feeding": "surface ambush; leaps to take insects/small animals from branches",
"structure": [
"flooded forest",
"overhanging branches",
"still water surface"
],
"lenCm": [
50,
90
],
"kg": [
1,
4.5
],
"tip": "나뭇가지가 드리운 수면에 작은 탑워터를 톡톡 튀기기",
"sources": [
"https://en.wikipedia.org/wiki/Silver_arowana",
"https://www.megafishingthailand.com/fish-species-in-thailand/introduced/silver-arowana-osteoglossum-bicirrhosum/"
],
"verified": true
},
"tilapia": {
"dmin": 0.5,
"dmax": 4,
"zone": "mid",
"act": {
"dawn": 0.7,
"day": 0.8,
"dusk": 0.7,
"night": 0.2
},
"pref": {
"paste": 1.0,
"worm": 0.75,
"shrimp": 0.03,
"cutbait": 0.03,
"livebait": 0.03,
"minnow": 0.112,
"spoon": 0.02,
"softworm": 0.15,
"topwater": 0.02,
"jig": 0.02,
"trolling": 0.02
},
"retrieve": "slow",
"retrieveNote": "small bait under float",
"feeding": "grazing omnivore on algae/detritus/plankton; nest-guarding in shallows",
"structure": [
"shallow flats",
"weed",
"mud"
],
"lenCm": [
20,
40
],
"kg": [
0.3,
2
],
"tip": "한낮 얕은 가장자리에 빵·곡물 떡밥 찌낚시",
"sources": [
"general knowledge"
],
"verified": false
},
"nileperch": {
"dmin": 3,
"dmax": 15,
"zone": "mid",
"act": {
"dawn": 0.9,
"day": 0.4,
"dusk": 0.9,
"night": 0.6
},
"pref": {
"paste": 0.03,
"worm": 0.03,
"shrimp": 0.03,
"cutbait": 0.75,
"livebait": 1.0,
"minnow": 0.75,
"spoon": 0.02,
"softworm": 0.55,
"topwater": 0.02,
"jig": 0.02,
"trolling": 1.0
},
"retrieve": "slow",
"retrieveNote": "slow troll deep divers ~9m over rapid depth changes; shallower (3-6m) in summer",
"feeding": "ambush/pursuit predator of tilapia and other fish around drop-offs",
"structure": [
"drop-offs",
"rock",
"submerged islands"
],
"lenCm": [
60,
150
],
"kg": [
5,
60
],
"tip": "여름엔 3~6m, 겨울엔 깊은 급경사 턱을 딥다이빙 미노우로 느린 트롤링",
"sources": [
"https://www.thefield.co.uk/features/fishing-for-monster-nile-perch-21794",
"https://www.memphistours.com/egypt/lake-nasser-fishing"
],
"verified": true
},
"eel": {
"dmin": 0.5,
"dmax": 5,
"zone": "bottom",
"act": {
"dawn": 0.3,
"day": 0.1,
"dusk": 0.8,
"night": 1.0
},
"pref": {
"paste": 0.03,
"worm": 1.0,
"shrimp": 0.55,
"cutbait": 0.03,
"livebait": 0.75,
"minnow": 0.02,
"spoon": 0.02,
"softworm": 0.02,
"topwater": 0.02,
"jig": 0.02,
"trolling": 0.02
},
"retrieve": "slow",
"retrieveNote": "static bait; lures essentially not used",
"feeding": "nocturnal scavenging/foraging from holes and crevices; hunts by smell",
"structure": [
"rock crevice",
"mud",
"river mouth"
],
"lenCm": [
40,
80
],
"kg": [
0.3,
1.5
],
"tip": "비 온 뒤 밤, 돌틈·하구 바닥에 청지렁이 원투낚시",
"sources": [
"https://m.fishingseasons.co.kr/news_Detail.asp?b_no=18515"
],
"verified": true
},
"snakehead": {
"dmin": 0,
"dmax": 2,
"zone": "top",
"act": {
"dawn": 0.8,
"day": 0.6,
"dusk": 0.8,
"night": 0.3
},
"pref": {
"paste": 0.03,
"worm": 0.03,
"shrimp": 0.03,
"cutbait": 0.03,
"livebait": 1.0,
"minnow": 0.55,
"spoon": 1.0,
"softworm": 0.75,
"topwater": 0.75,
"jig": 0.02,
"trolling": 0.02
},
"retrieve": "slow",
"retrieveNote": "walk frog over weed mats with pauses; strike after 1-2 s",
"feeding": "ambush predator in dense weed; air-breather taking prey at surface; guards nests May-Aug",
"structure": [
"weed(수초밭)",
"lily pads",
"still shallow water"
],
"lenCm": [
50,
80
],
"kg": [
1.5,
6
],
"tip": "5~7월 산란기 수초밭 위로 프로그 루어를 천천히 끌다 멈추기",
"sources": [
"https://fishingseasons.co.kr/contents_view_detail.asp?b_no=675",
"https://m.wolchuck.co.kr/%EC%9B%94%EC%B2%99%EC%A7%80%EC%8B%9D/%EA%B8%B0%ED%83%80%EC%A7%80%EC%8B%9D/%EA%B0%80%EB%AC%BC%EC%B9%98-%EB%A3%A8%EC%96%B4%EB%82%9A%EC%8B%9C"
],
"verified": true
},
"sturgeon": {
"dmin": 5,
"dmax": 25,
"zone": "bottom",
"act": {
"dawn": 0.6,
"day": 0.6,
"dusk": 0.6,
"night": 0.6
},
"pref": {
"paste": 0.03,
"worm": 0.55,
"shrimp": 1.0,
"cutbait": 0.75,
"livebait": 0.03,
"minnow": 0.02,
"spoon": 0.02,
"softworm": 0.02,
"topwater": 0.02,
"jig": 0.02,
"trolling": 0.02
},
"retrieve": "slow",
"retrieveNote": "heavy weight holding bait still on bottom; bites are subtle",
"feeding": "bottom scavenging/foraging with barbels; smell-driven",
"structure": [
"mud",
"sand",
"deep river holes",
"current"
],
"lenCm": [
100,
200
],
"kg": [
15,
90
],
"tip": "강의 깊은 골 바닥에 모래새우·청어 토막을 무거운 봉돌로 고정",
"sources": [
"https://myodfw.com/articles/sturgeon-fishing-oregon",
"https://myodfw.com/fishing/species/white-sturgeon"
],
"verified": true
},
"arapaima": {
"dmin": 0.5,
"dmax": 4,
"zone": "top",
"act": {
"dawn": 0.8,
"day": 0.6,
"dusk": 0.8,
"night": 0.4
},
"pref": {
"paste": 0.03,
"worm": 0.03,
"shrimp": 0.03,
"cutbait": 0.75,
"livebait": 1.0,
"minnow": 0.75,
"spoon": 0.02,
"softworm": 0.02,
"topwater": 1.0,
"jig": 0.02,
"trolling": 0.02
},
"retrieve": "slow",
"retrieveNote": "slow surface lure in front of rolling fish; stealth",
"feeding": "air-breathing ambush predator; surfaces every 5-20 min to gulp air, spooks easily",
"structure": [
"still lagoon",
"flooded forest",
"weed"
],
"lenCm": [
120,
220
],
"kg": [
30,
150
],
"tip": "피라루쿠가 숨 쉬러 올라온 자리에 조용히 생선 토막이나 느린 탑워터를",
"sources": [
"https://fishingbooker.com/blog/arapaima-fishing/",
"https://www.nootica.com/webzine/fishing-for-arapaima.html"
],
"verified": true
},
"musky": {
"dmin": 1,
"dmax": 6,
"zone": "mid",
"act": {
"dawn": 0.8,
"day": 0.5,
"dusk": 0.9,
"night": 0.3
},
"pref": {
"paste": 0.03,
"worm": 0.03,
"shrimp": 0.03,
"cutbait": 0.03,
"livebait": 1.0,
"minnow": 0.4,
"spoon": 1.0,
"softworm": 0.55,
"topwater": 0.75,
"jig": 0.02,
"trolling": 0.3
},
"retrieve": "fast",
"retrieveNote": "finish every cast with figure-8 at boatside",
"feeding": "solitary ambush predator; follows lures and strikes on direction change",
"structure": [
"weed",
"rock",
"drop-offs"
],
"lenCm": [
80,
120
],
"kg": [
5,
15
],
"tip": "해질녘 수초 턱을 벅테일로 빠르게 감고 배 옆에서 8자 그리기",
"sources": [
"https://anglingsports.ca/blogs/fishing-tips-tricks/figure-8-musky-fishing",
"https://fishncanada.com/how-to-figure-8-for-muskie/"
],
"verified": true
},
"ureok": {
"dmin": 5,
"dmax": 40,
"zone": "bottom",
"act": {
"dawn": 0.8,
"day": 0.5,
"dusk": 0.8,
"night": 0.7
},
"pref": {
"paste": 0.03,
"worm": 0.55,
"shrimp": 1.0,
"cutbait": 0.4,
"livebait": 0.75,
"minnow": 0.55,
"spoon": 0.02,
"softworm": 1.0,
"topwater": 0.02,
"jig": 0.75,
"trolling": 0.02
},
"retrieve": "slow",
"retrieveNote": "bottom bouncing/lift-and-drop near rocks",
"feeding": "ambush predator hiding in rocks/reefs; eats small fish, shrimp, squid",
"structure": [
"rock",
"reef",
"wrecks"
],
"lenCm": [
25,
50
],
"kg": [
0.3,
2
],
"tip": "암초 바닥에 오징어살·웜 채비로 바닥 찍고 살짝 띄우기 반복",
"sources": [
"https://fishbase.se/summary/Sebastes-schlegelii.html"
],
"verified": true
},
"gwangeo": {
"dmin": 5,
"dmax": 50,
"zone": "bottom",
"act": {
"dawn": 0.9,
"day": 0.6,
"dusk": 0.8,
"night": 0.3
},
"pref": {
"paste": 0.03,
"worm": 0.03,
"shrimp": 0.75,
"cutbait": 0.55,
"livebait": 1.0,
"minnow": 0.02,
"spoon": 0.02,
"softworm": 1.0,
"topwater": 0.02,
"jig": 0.75,
"trolling": 0.02
},
"retrieve": "slow",
"retrieveNote": "drag/down-shot along sand, occasional lift; wait before hookset",
"feeding": "buried ambush predator on sand; strikes upward at passing fish",
"structure": [
"sand",
"sand-rock edge",
"mud"
],
"lenCm": [
35,
70
],
"kg": [
0.7,
5
],
"tip": "모래와 암초 경계 바닥에 다운샷 웜을 천천히 끌기",
"sources": [
"https://fishbase.se/summary/Paralichthys-olivaceus"
],
"verified": true
},
"chamdom": {
"dmin": 10,
"dmax": 80,
"zone": "bottom",
"act": {
"dawn": 1.0,
"day": 0.6,
"dusk": 0.8,
"night": 0.3
},
"pref": {
"paste": 0.03,
"worm": 0.75,
"shrimp": 1.0,
"cutbait": 0.03,
"livebait": 0.03,
"minnow": 0.02,
"spoon": 0.02,
"softworm": 0.75,
"topwater": 0.02,
"jig": 1.0,
"trolling": 0.02
},
"retrieve": "slow",
"retrieveNote": "constant-speed retrieve (~1 m per 2 s) from bottom, 5-10 turns; don't strike on first taps",
"feeding": "foraging predator of crustaceans, shellfish and small fish near bottom",
"structure": [
"rock",
"reef",
"current"
],
"lenCm": [
35,
70
],
"kg": [
0.8,
5
],
"tip": "타이라바 바닥 찍고 일정 속도로 감아 올리다 입질 와도 그대로 등속",
"sources": [
"https://m.fishingseasons.co.kr/news_Detail.asp?b_no=15195",
"https://rhyzomecorp.co.kr/journal/june-redbream-tairaba-guide/"
],
"verified": true
},
"nongeo": {
"dmin": 0.5,
"dmax": 10,
"zone": "mid",
"act": {
"dawn": 0.9,
"day": 0.3,
"dusk": 1.0,
"night": 0.8
},
"pref": {
"paste": 0.03,
"worm": 0.55,
"shrimp": 0.75,
"cutbait": 0.03,
"livebait": 1.0,
"minnow": 1.0,
"spoon": 0.02,
"softworm": 0.55,
"topwater": 0.75,
"jig": 0.4,
"trolling": 0.02
},
"retrieve": "medium",
"retrieveNote": "steady retrieve just fast enough to feel wobble; strong around spring tides (6~9물)",
"feeding": "pursuit/ambush predator in surf and white water; follows bait into foam",
"structure": [
"rock",
"current",
"surf foam(포말)",
"river mouth"
],
"lenCm": [
40,
80
],
"kg": [
1,
5
],
"tip": "해질녘~밤 파도치는 갯바위 포말 지대에 미노우를 일정하게 감기",
"sources": [
"https://fishdaily.kr/target/seabass-lure",
"https://fishingseasons.co.kr/newscolumn/newscolumn_view.asp?b_no=1699"
],
"verified": true
},
"gamseong": {
"dmin": 3,
"dmax": 15,
"zone": "bottom",
"act": {
"dawn": 1.0,
"day": 0.5,
"dusk": 0.9,
"night": 0.4
},
"pref": {
"paste": 0.55,
"worm": 0.75,
"shrimp": 1.0,
"cutbait": 0.03,
"livebait": 0.03,
"minnow": 0.112,
"spoon": 0.02,
"softworm": 0.15,
"topwater": 0.02,
"jig": 0.02,
"trolling": 0.02
},
"retrieve": "slow",
"retrieveNote": "bait drifts with chum near bottom; mostly float fishing",
"feeding": "cautious bottom forager of crustaceans, shellfish, worms; drawn by chum",
"structure": [
"rock",
"reef edges",
"sand-rock"
],
"lenCm": [
25,
45
],
"kg": [
0.4,
2
],
"tip": "새벽·해질녘 들물·날물 때 밑밥 흐름에 크릴을 태워 바닥층 찌낚시",
"sources": [
"https://m.fishingseasons.co.kr/news_Detail.asp?b_no=4506",
"https://moafishing.com/fish/%EA%B0%90%EC%84%B1%EB%8F%94/"
],
"verified": true
},
"godeungeo": {
"dmin": 1,
"dmax": 20,
"zone": "mid",
"act": {
"dawn": 0.9,
"day": 0.6,
"dusk": 0.9,
"night": 0.4
},
"pref": {
"paste": 0.55,
"worm": 0.03,
"shrimp": 1.0,
"cutbait": 0.75,
"livebait": 0.03,
"minnow": 0.02,
"spoon": 0.75,
"softworm": 0.02,
"topwater": 0.02,
"jig": 1.0,
"trolling": 0.02
},
"retrieve": "fast",
"retrieveNote": "fast jerking; sabiki multi-hook",
"feeding": "schooling pursuit feeder on small fish and plankton",
"structure": [
"open water",
"piers",
"current"
],
"lenCm": [
20,
40
],
"kg": [
0.2,
1
],
"tip": "해질녘 방파제에서 카드채비나 작은 메탈지그를 빠르게 저킹",
"sources": [
"general knowledge"
],
"verified": false
},
"gt": {
"dmin": 1,
"dmax": 30,
"zone": "top",
"act": {
"dawn": 1.0,
"day": 0.6,
"dusk": 0.9,
"night": 0.5
},
"pref": {
"paste": 0.03,
"worm": 0.03,
"shrimp": 0.03,
"cutbait": 0.75,
"livebait": 1.0,
"minnow": 0.55,
"spoon": 0.02,
"softworm": 0.02,
"topwater": 1.0,
"jig": 0.75,
"trolling": 0.02
},
"retrieve": "fast",
"retrieveNote": "big splashing popper along reef drop-off, fast",
"feeding": "apex pursuit/ambush predator on reef edges; explosive surface strikes",
"structure": [
"reef",
"drop-offs",
"current",
"flats"
],
"lenCm": [
60,
120
],
"kg": [
8,
40
],
"tip": "새벽 산호초 절벽 조류대에서 큰 포퍼를 빠르게 튀기기",
"sources": [
"https://www.fishbase.se/summary/caranx-ignobilis",
"https://en.wikipedia.org/wiki/Giant_trevally"
],
"verified": true
},
"barracuda": {
"dmin": 1,
"dmax": 20,
"zone": "mid",
"act": {
"dawn": 0.8,
"day": 0.8,
"dusk": 0.7,
"night": 0.3
},
"pref": {
"paste": 0.03,
"worm": 0.03,
"shrimp": 0.03,
"cutbait": 0.75,
"livebait": 1.0,
"minnow": 1.0,
"spoon": 0.75,
"softworm": 0.02,
"topwater": 0.55,
"jig": 0.02,
"trolling": 0.4
},
"retrieve": "fast",
"retrieveNote": "very fast retrieve; wire leader",
"feeding": "fast ambush pursuit predator attracted by flash",
"structure": [
"reef",
"flats",
"open water"
],
"lenCm": [
60,
120
],
"kg": [
3,
15
],
"tip": "낮 산호초 가장자리에 반짝이는 스푼을 최대 속도로 감기",
"sources": [
"general knowledge"
],
"verified": false
},
"grouper": {
"dmin": 10,
"dmax": 50,
"zone": "bottom",
"act": {
"dawn": 0.8,
"day": 0.5,
"dusk": 0.8,
"night": 0.5
},
"pref": {
"paste": 0.03,
"worm": 0.03,
"shrimp": 0.75,
"cutbait": 0.55,
"livebait": 1.0,
"minnow": 0.02,
"spoon": 0.02,
"softworm": 1.0,
"topwater": 0.02,
"jig": 0.75,
"trolling": 0.02
},
"retrieve": "slow",
"retrieveNote": "slow pitch jig just off rocks; lift immediately after hookset",
"feeding": "ambush predator from rocky crevices",
"structure": [
"rock",
"reef",
"crevice"
],
"lenCm": [
25,
45
],
"kg": [
0.5,
2
],
"tip": "여름 제주 암초 바닥에 오징어 미끼나 슬로우지그를 틈 가까이",
"sources": [
"general knowledge"
],
"verified": false
},
"mahi": {
"dmin": 0,
"dmax": 15,
"zone": "top",
"act": {
"dawn": 0.9,
"day": 0.9,
"dusk": 0.7,
"night": 0.1
},
"pref": {
"paste": 0.03,
"worm": 0.03,
"shrimp": 0.55,
"cutbait": 0.75,
"livebait": 1.0,
"minnow": 0.02,
"spoon": 0.4,
"softworm": 0.02,
"topwater": 0.75,
"jig": 0.55,
"trolling": 1.0
},
"retrieve": "fast",
"retrieveNote": "troll 11-15 km/h along weedlines; keep one hooked fish in water to hold school",
"feeding": "fast schooling pursuit predator under floating weed/debris",
"structure": [
"open water",
"weedline(해조 띠)",
"floating debris"
],
"lenCm": [
60,
120
],
"kg": [
3,
15
],
"tip": "먼바다 해조 띠 가장자리를 트롤링하다 떼를 만나면 캐스팅",
"sources": [
"https://thetackleroom.com/blogs/news/how-to-catch-mahi-mahi-under-weedlines-and-sargassum",
"https://www.thefisherman.com/article/offshore-adjusting-to-dolphin-depths/"
],
"verified": true
},
"parrot": {
"dmin": 2,
"dmax": 30,
"zone": "bottom",
"act": {
"dawn": 0.5,
"day": 1.0,
"dusk": 0.5,
"night": 0.0
},
"pref": {
"paste": 0.75,
"worm": 0.55,
"shrimp": 1.0,
"cutbait": 0.03,
"livebait": 0.03,
"minnow": 0.02,
"spoon": 0.02,
"softworm": 0.02,
"topwater": 0.02,
"jig": 0.02,
"trolling": 0.02
},
"retrieve": "slow",
"retrieveNote": "rarely takes lures; small bait near reef by day",
"feeding": "grazing: scrapes algae from coral/rock; sleeps in mucus cocoon at night",
"structure": [
"reef",
"coral",
"lagoon"
],
"lenCm": [
30,
60
],
"kg": [
0.5,
3
],
"tip": "한낮 산호초 위에 작은 새우 미끼를 조용히 흘리기",
"sources": [
"https://fishbase.se/summary/5548",
"https://australian.museum/learn/animals/fishes/bluebarred-parrotfish-scarus-ghobban-forsskl-1775/"
],
"verified": true
},
"snapper": {
"dmin": 10,
"dmax": 70,
"zone": "bottom",
"act": {
"dawn": 0.9,
"day": 0.5,
"dusk": 0.9,
"night": 0.7
},
"pref": {
"paste": 0.03,
"worm": 0.03,
"shrimp": 0.55,
"cutbait": 1.0,
"livebait": 0.75,
"minnow": 0.02,
"spoon": 0.02,
"softworm": 0.75,
"topwater": 0.55,
"jig": 1.0,
"trolling": 0.02
},
"retrieve": "medium",
"retrieveNote": "vertical jig near reef drop-off",
"feeding": "reef ambush/pursuit predator of fish and crustaceans",
"structure": [
"reef",
"drop-offs",
"current"
],
"lenCm": [
40,
75
],
"kg": [
2,
9
],
"tip": "해질녘 산호초 절벽에서 메탈지그 수직 지깅",
"sources": [
"general knowledge"
],
"verified": false
},
"cod": {
"dmin": 20,
"dmax": 120,
"zone": "bottom",
"act": {
"dawn": 0.8,
"day": 0.7,
"dusk": 0.8,
"night": 0.5
},
"pref": {
"paste": 0.03,
"worm": 0.75,
"shrimp": 0.55,
"cutbait": 1.0,
"livebait": 0.03,
"minnow": 0.02,
"spoon": 0.02,
"softworm": 0.75,
"topwater": 0.02,
"jig": 1.0,
"trolling": 0.02
},
"retrieve": "slow",
"retrieveNote": "lift-and-drop pirk near bottom",
"feeding": "opportunistic bottom predator of fish, crustaceans",
"structure": [
"rock",
"gravel",
"wrecks"
],
"lenCm": [
50,
100
],
"kg": [
2,
12
],
"tip": "겨울 깊은 암반 바닥에 무거운 피크를 들었다 놓기",
"sources": [
"general knowledge"
],
"verified": false
},
"halibut": {
"dmin": 20,
"dmax": 300,
"zone": "bottom",
"act": {
"dawn": 0.7,
"day": 0.8,
"dusk": 0.7,
"night": 0.4
},
"pref": {
"paste": 0.03,
"worm": 0.03,
"shrimp": 0.03,
"cutbait": 1.0,
"livebait": 0.75,
"minnow": 0.02,
"spoon": 0.02,
"softworm": 0.75,
"topwater": 0.02,
"jig": 1.0,
"trolling": 0.02
},
"retrieve": "slow",
"retrieveNote": "slow jig/shad a few metres off bottom; summer shallower (~10m), otherwise 60-300m",
"feeding": "large ambush/pursuit predator of fish; rises off bottom to chase",
"structure": [
"sand",
"gravel",
"boulder",
"shoals"
],
"lenCm": [
80,
180
],
"kg": [
10,
100
],
"tip": "여름 얕은 모래자갈 여울에서 대형 섀드웜을 바닥 위로 천천히 감기",
"sources": [
"https://www.sportfishingmag.com/travel/atlantic-halibut-fishing/",
"https://norwegianfishing.com/halibut-fishing-in-norway/"
],
"verified": true
},
"pollock": {
"dmin": 50,
"dmax": 200,
"zone": "mid",
"act": {
"dawn": 0.7,
"day": 0.5,
"dusk": 0.7,
"night": 0.6
},
"pref": {
"paste": 0.03,
"worm": 0.03,
"shrimp": 1.0,
"cutbait": 0.75,
"livebait": 0.03,
"minnow": 0.02,
"spoon": 0.02,
"softworm": 0.02,
"topwater": 0.02,
"jig": 1.0,
"trolling": 0.02
},
"retrieve": "medium",
"retrieveNote": "vertical jig mid-depth; follows night-up migration",
"feeding": "schooling semi-pelagic feeder on krill and small fish; vertical migration",
"structure": [
"open water",
"cold water",
"continental shelf"
],
"lenCm": [
35,
60
],
"kg": [
0.5,
2
],
"tip": "겨울 깊은 찬 바다 중층을 메탈지그로 수직 탐색",
"sources": [
"general knowledge"
],
"verified": false
},
"conger": {
"dmin": 3,
"dmax": 50,
"zone": "bottom",
"act": {
"dawn": 0.3,
"day": 0.1,
"dusk": 0.8,
"night": 1.0
},
"pref": {
"paste": 0.03,
"worm": 1.0,
"shrimp": 0.75,
"cutbait": 0.55,
"livebait": 0.03,
"minnow": 0.02,
"spoon": 0.02,
"softworm": 0.02,
"topwater": 0.02,
"jig": 0.02,
"trolling": 0.02
},
"retrieve": "slow",
"retrieveNote": "static bottom bait at night",
"feeding": "nocturnal scavenging/ambush from sand burrows and rock holes",
"structure": [
"sand",
"mud",
"rock",
"breakwater"
],
"lenCm": [
40,
80
],
"kg": [
0.3,
1.5
],
"tip": "밤 방파제 모래바닥에 고등어 토막·청갯지렁이 원투",
"sources": [
"general knowledge"
],
"verified": false
},
"bangeo": {
"dmin": 10,
"dmax": 80,
"zone": "mid",
"act": {
"dawn": 1.0,
"day": 0.6,
"dusk": 0.9,
"night": 0.2
},
"pref": {
"paste": 0.03,
"worm": 0.03,
"shrimp": 0.75,
"cutbait": 0.03,
"livebait": 1.0,
"minnow": 0.02,
"spoon": 0.02,
"softworm": 0.02,
"topwater": 0.75,
"jig": 1.0,
"trolling": 0.55
},
"retrieve": "fast",
"retrieveNote": "fast jigging / high-speed retrieve; winter main-current 150-200g jigs",
"feeding": "schooling pursuit predator of small fish in strong current",
"structure": [
"current(본류)",
"reef pinnacles",
"open water"
],
"lenCm": [
50,
90
],
"kg": [
2,
10
],
"tip": "겨울 새벽 본류대 암초 위에서 메탈지그를 빠르게 저킹",
"sources": [
"https://moafishing.com/guide/%EB%B0%A9%EC%96%B4-%EB%B6%80%EC%8B%9C%EB%A6%AC-%EA%B8%B0%EB%B3%B8/",
"https://www.ocean-fishing.com/fish/5"
],
"verified": true
},
"tuna": {
"dmin": 0,
"dmax": 90,
"zone": "mid",
"act": {
"dawn": 1.0,
"day": 0.6,
"dusk": 0.8,
"night": 0.3
},
"pref": {
"paste": 0.03,
"worm": 0.03,
"shrimp": 0.55,
"cutbait": 0.75,
"livebait": 1.0,
"minnow": 0.02,
"spoon": 0.02,
"softworm": 0.02,
"topwater": 1.0,
"jig": 0.75,
"trolling": 0.55
},
"retrieve": "fast",
"retrieveNote": "cast into surface boils; deep fish (30-90m) with flat-fall jigs",
"feeding": "fast schooling pursuit predator; boils (foamers) on bait at surface",
"structure": [
"open water",
"current",
"temperature breaks"
],
"lenCm": [
80,
180
],
"kg": [
15,
150
],
"tip": "새벽 수면 파장(보일)에 스틱베이트 캐스팅, 깊으면 플랫폴 지그",
"sources": [
"https://fishingbooker.com/blog/bluefin-tuna-fishing/",
"https://thetackleroom.com/blogs/news/bluefin-tuna-fishing-guide-tackle-techniques-and-where-to-find-giants"
],
"verified": true
},
"sailfish": {
"dmin": 0,
"dmax": 30,
"zone": "top",
"act": {
"dawn": 0.9,
"day": 0.8,
"dusk": 0.7,
"night": 0.1
},
"pref": {
"paste": 0.03,
"worm": 0.03,
"shrimp": 0.03,
"cutbait": 0.75,
"livebait": 1.0,
"minnow": 0.02,
"spoon": 0.02,
"softworm": 0.02,
"topwater": 0.75,
"jig": 0.02,
"trolling": 1.0
},
"retrieve": "medium",
"retrieveNote": "kite-fished live bait at surface; drop-back before hookset; circle hooks",
"feeding": "pursuit predator herding bait schools with its sail; slashes with bill",
"structure": [
"open water",
"reef edge drop-off",
"current edge"
],
"lenCm": [
150,
250
],
"kg": [
20,
50
],
"tip": "대륙붕 끝 30~90m 수심에서 카이트로 살아있는 미끼를 수면에 띄우기",
"sources": [
"https://www.marlinmag.com/kite-fishing-skills-for-sailfish/",
"https://www.floridasportsman.com/editorial/expert-kite-fishing-tips-south-florida-kite-fishing/468810"
],
"verified": true
},
"moray": {
"dmin": 1,
"dmax": 50,
"zone": "bottom",
"act": {
"dawn": 0.4,
"day": 0.2,
"dusk": 0.8,
"night": 1.0
},
"pref": {
"paste": 0.03,
"worm": 0.03,
"shrimp": 0.75,
"cutbait": 1.0,
"livebait": 0.55,
"minnow": 0.02,
"spoon": 0.02,
"softworm": 0.02,
"topwater": 0.02,
"jig": 0.02,
"trolling": 0.02
},
"retrieve": "slow",
"retrieveNote": "static bait next to reef holes; pull fast before it retreats",
"feeding": "nocturnal ambush predator from reef holes; hunts by smell",
"structure": [
"reef",
"crevice",
"coral"
],
"lenCm": [
100,
250
],
"kg": [
10,
30
],
"tip": "밤 산호초 구멍 앞에 생선 토막을 두고 물면 바로 끌어내기",
"sources": [
"https://www.fishbase.se/summary/Gymnothorax-javanicus.html",
"https://australian.museum/learn/animals/fishes/giant-moray-gymnothorax-javanicus-bleeker-1859/"
],
"verified": true
},
"mako": {
"dmin": 5,
"dmax": 60,
"zone": "mid",
"act": {
"dawn": 0.8,
"day": 0.8,
"dusk": 0.7,
"night": 0.5
},
"pref": {
"paste": 0.03,
"worm": 0.03,
"shrimp": 0.03,
"cutbait": 1.0,
"livebait": 0.75,
"minnow": 0.02,
"spoon": 0.02,
"softworm": 0.02,
"topwater": 0.02,
"jig": 0.02,
"trolling": 1.0
},
"retrieve": "fast",
"retrieveNote": "drift in chum slick; baits 10-15 m down and near thermocline",
"feeding": "very fast pursuit predator of tuna, mackerel, bluefish; leaps when hooked",
"structure": [
"open water",
"thermocline",
"current edge"
],
"lenCm": [
150,
250
],
"kg": [
40,
150
],
"tip": "먼바다 맑은 수온대에서 밑밥띠를 만들고 고등어 통미끼를 10~15m에 흘리기",
"sources": [
"https://www.fisheries.noaa.gov/species/pacific-shortfin-mako-shark",
"https://www.saltwatersportsman.com/mako-shark-fishing-northeast-atlantic-ocean/"
],
"verified": true
},
"blacktip": {
"dmin": 1,
"dmax": 30,
"zone": "mid",
"act": {
"dawn": 0.9,
"day": 0.6,
"dusk": 0.9,
"night": 0.6
},
"pref": {
"paste": 0.03,
"worm": 0.03,
"shrimp": 0.03,
"cutbait": 1.0,
"livebait": 0.75,
"minnow": 0.02,
"spoon": 1.0,
"softworm": 0.02,
"topwater": 0.02,
"jig": 0.75,
"trolling": 0.02
},
"retrieve": "medium",
"retrieveNote": "chum; cut bait near surf troughs and passes",
"feeding": "fast pursuit predator of schooling fish; spins/leaps",
"structure": [
"sand",
"surf",
"reef",
"open water"
],
"lenCm": [
100,
180
],
"kg": [
20,
50
],
"tip": "해질녘 해안 파도골·조류 통로에 생선 토막과 밑밥",
"sources": [
"general knowledge"
],
"verified": false
},
"hammerhead": {
"dmin": 5,
"dmax": 60,
"zone": "mid",
"act": {
"dawn": 0.7,
"day": 0.4,
"dusk": 0.8,
"night": 1.0
},
"pref": {
"paste": 0.03,
"worm": 0.03,
"shrimp": 0.75,
"cutbait": 1.0,
"livebait": 0.55,
"minnow": 0.02,
"spoon": 0.02,
"softworm": 0.02,
"topwater": 0.02,
"jig": 0.02,
"trolling": 1.0
},
"retrieve": "slow",
"retrieveNote": "drift bait in chum at depth",
"feeding": "schools by day near shore/seamounts, disperses offshore at night to hunt fish and squid",
"structure": [
"open water",
"seamounts",
"drop-offs"
],
"lenCm": [
150,
300
],
"kg": [
30,
150
],
"tip": "밤 해산·급경사 주변 조류에 오징어·생선 토막 흘리기",
"sources": [
"https://www.fishbase.se/summary/912",
"https://australian.museum/learn/animals/fishes/scalloped-hammerhead-sphyrna-lewini/"
],
"verified": true
},
"mola": {
"dmin": 0,
"dmax": 200,
"zone": "top",
"act": {
"dawn": 0.5,
"day": 0.8,
"dusk": 0.5,
"night": 0.2
},
"pref": {
"paste": 0.03,
"worm": 0.03,
"shrimp": 1.0,
"cutbait": 0.75,
"livebait": 0.03,
"minnow": 0.02,
"spoon": 0.02,
"softworm": 0.02,
"topwater": 0.02,
"jig": 0.02,
"trolling": 0.02
},
"retrieve": "slow",
"retrieveNote": "almost never targeted; incidental hook-ups while drifting",
"feeding": "slow feeder on jellyfish, salps, crustaceans; dives deep then basks at surface",
"structure": [
"open water",
"temperate surface"
],
"lenCm": [
100,
250
],
"kg": [
200,
1000
],
"tip": "맑은 날 먼바다 수면에 누워 일광욕하는 개복치 근처에 미끼 드리우기",
"sources": [
"https://australian.museum/learn/animals/fishes/ocean-sunfish-mola-mola/",
"https://ocean.si.edu/ocean-life/fish/mola-mola-oceans-gentle-giant"
],
"verified": true
},
"whaleshark": {
"sight": true,
"dmin": 0,
"dmax": 20,
"lenM": [
6,
12
],
"nearBoats": "Docile; surface filter-feeds ~7 h/day in daylight on plankton, dives deeper at night; tolerates boats but often scarred by strikes",
"sources": [
"https://pmc.ncbi.nlm.nih.gov/articles/PMC1618489/",
"https://www.sciencedirect.com/science/article/abs/pii/S0944200610000486"
],
"verified": true
},
"manta": {
"sight": true,
"dmin": 0,
"dmax": 40,
"lenM": [
4,
7
],
"nearBoats": "Curious and calm; visits cleaning stations on reefs, feeds on plankton at surface, sometimes breaches; approaches divers/boats",
"sources": [
"general knowledge"
],
"verified": false
},
"turtle": {
"sight": true,
"dmin": 0,
"dmax": 20,
"lenM": [
0.8,
1.2
],
"nearBoats": "Surfaces to breathe every few minutes; grazes seagrass/algae in shallow bays; dives away from approaching boats",
"sources": [
"general knowledge"
],
"verified": false
},
"dolphin": {
"sight": true,
"dmin": 0,
"dmax": 30,
"lenM": [
2,
2.6
],
"nearBoats": "Coastal pods (Jeju: mostly within 500 m of shore, <100 m deep); may bow-ride or follow boats, stressed by heavy boat traffic",
"sources": [
"https://www.tandfonline.com/doi/full/10.1080/19768354.2010.506685",
"https://www.researchgate.net/publication/297718077_Occurrence_of_Indo-Pacific_Bottlenose_Dolphins_Tursiops_aduncus_off_Jeju_Island_Korea_during_the_Early_2000s"
],
"verified": true
},
"humpback": {
"sight": true,
"dmin": 0,
"dmax": 100,
"lenM": [
12,
16
],
"nearBoats": "Breaches, tail/fin-slaps, spouts visible from afar; bubble-net feeding in cold seas; generally tolerant of boats at distance",
"sources": [
"general knowledge"
],
"verified": false
},
"orca": {
"sight": true,
"dmin": 0,
"dmax": 100,
"lenM": [
6,
8
],
"nearBoats": "Travels in family pods with tall dorsal fins; curious, may approach boats; hunts fish, seals, other cetaceans",
"sources": [
"general knowledge"
],
"verified": false
}
};
