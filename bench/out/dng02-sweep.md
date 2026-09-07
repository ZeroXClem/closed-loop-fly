# DNg02 injection sweep and the PS080 relay

Collected from bench/bridge.mjs runs (2026-09-07). Drum ±1 rad/s, still-drum warm-up 3 s, then 1 s (JS LIF) or 3 s (GPU) windows per direction. [A] = AbijahKaj optic-v2 rate net (CPU); [B] = Xenova MaleCNS LIF. Bridge = HS + LC4 + LPLC2 (317 cells) unless 'inputs' (1,114). DNg02 tonic = constant current on [B]'s 29 DNg02 cells through the inject API. 'DSI' = (CW − CCW)/(CW + CCW) per side.

## GPU run (RTX 3070), bench/out/bridge-gpu.json: gains 2 and 4, tonic 0.5, plus control

    == bridge on, gain 2, DNg02 tonic 0.5 mV/ms; set validated; backend gpu; hold per frame
       95 ms wall per 16.7 ms frame (0.176x realtime); optic 25 ms, LIF 70 ms per frame
       drum ω=1: [A] HS L 1.675 R 0.074 turn 1.397 | [B] HS 124.1/0.1 Hz, DNg02 30.71/30.40 Hz, wing MN 59.33/56.81 Hz, turn DN 16.22/3.53 Hz, 1493 spikes/frame
       drum ω=-1: [A] HS L 0.344 R 1.114 turn -0.731 | [B] HS 10.5/57.5 Hz, DNg02 30.52/30.15 Hz, wing MN 57.28/54.91 Hz, turn DN 9.28/6.42 Hz, 1222 spikes/frame
       still: [B] DNg02 31.53/31.03 Hz, HS 0.0/0.0 Hz, wing MN 58.10/55.58 Hz, 1438 spikes/frame
       DNg02 L−R: CW 0.310 Hz, CCW 0.369 Hz; DSI(CW vs CCW) L 0.00 R 0.00; [A] turn CW 1.40 CCW -0.73
       loom from −45°: [A] loom L peak 4.900 (R 0.000); [B] LC4 L 0.0 → peak 232.1 Hz, LPLC2 L 0.0 → 144.7 Hz, DNp01 1.0 → peak 207.5 Hz (DNp01–06 0.2 → 148.5)
    == bridge on, gain 4, DNg02 tonic 0.5 mV/ms; set validated; backend gpu; hold per frame
       97 ms wall per 16.7 ms frame (0.171x realtime); optic 24 ms, LIF 64 ms per frame
       drum ω=1: [A] HS L 1.675 R 0.074 turn 1.397 | [B] HS 175.0/0.5 Hz, DNg02 29.75/28.79 Hz, wing MN 56.84/54.40 Hz, turn DN 11.47/4.16 Hz, 1119 spikes/frame
       drum ω=-1: [A] HS L 0.344 R 1.114 turn -0.731 | [B] HS 23.0/99.7 Hz, DNg02 29.47/28.93 Hz, wing MN 55.50/52.99 Hz, turn DN 7.84/6.61 Hz, 927 spikes/frame
       still: [B] DNg02 31.53/31.03 Hz, HS 0.0/0.0 Hz, wing MN 58.10/55.58 Hz, 1438 spikes/frame
       DNg02 L−R: CW 0.963 Hz, CCW 0.540 Hz; DSI(CW vs CCW) L 0.00 R -0.00; [A] turn CW 1.40 CCW -0.73
       loom from −45°: [A] loom L peak 4.900 (R 0.000); [B] LC4 L 0.0 → peak 268.6 Hz, LPLC2 L 0.0 → 175.7 Hz, DNp01 0.0 → peak 240.8 Hz (DNp01–06 0.2 → 161.0)
    == bridge OFF (control), DNg02 tonic 0.5 mV/ms; set validated; backend gpu; hold per frame
       99 ms wall per 16.7 ms frame (0.169x realtime); optic 24 ms, LIF 70 ms per frame
       drum ω=1: [A] HS L 1.675 R 0.074 turn 1.397 | [B] HS 0.0/0.0 Hz, DNg02 30.43/29.76 Hz, wing MN 57.14/54.45 Hz, turn DN 8.33/4.14 Hz, 1029 spikes/frame
       drum ω=-1: [A] HS L 0.344 R 1.114 turn -0.731 | [B] HS 0.0/0.0 Hz, DNg02 29.87/29.47 Hz, wing MN 56.22/53.94 Hz, turn DN 10.64/5.35 Hz, 1184 spikes/frame
       still: [B] DNg02 31.53/31.03 Hz, HS 0.0/0.0 Hz, wing MN 58.10/55.58 Hz, 1438 spikes/frame
       DNg02 L−R: CW 0.670 Hz, CCW 0.406 Hz; DSI(CW vs CCW) L 0.01 R 0.00; [A] turn CW 1.40 CCW -0.73
    VERDICT FAIL: best gain 4 / DNg02 tonic 0.5: DNg02 lateralised false, DSI 0.00 (target > 0.3; control 0.01); loom → DNp01 true

## JavaScript LIF, dev VM: tonic 0.5 with relay readouts (PS080, OA-VUMa4, GNG286, DNa02)

    == bridge on, gain 2, DNg02 tonic 0.5 mV/ms; set validated; backend cpu; hold per frame
       drum ω=1: [A] HS L 1.672 R 0.121 turn 1.353 | [B] HS 117.9/0.2 Hz, DNg02 30.06/29.42 Hz, wing MN 58.26/55.66 Hz, DNa02 32.0/6.6 Hz, 1429 spikes/frame
          relays: PS080 14.3/19.3 Hz, OA-VUMa4 43.9 Hz, GNG286 19.4/16.0 Hz
       drum ω=-1: [A] HS L 0.463 R 0.964 turn -0.488 | [B] HS 14.9/47.6 Hz, DNg02 28.70/27.65 Hz, wing MN 53.84/51.01 Hz, DNa02 7.8/14.8 Hz, 663 spikes/frame
          relays: PS080 3.4/2.7 Hz, OA-VUMa4 5.0 Hz, GNG286 3.4/2.7 Hz
       still: [B] DNg02 28.45/27.93 Hz, HS 0.0/0.0 Hz, wing MN 57.05/54.21 Hz, 913 spikes/frame
       DNg02 L−R: CW 0.643 Hz, CCW 1.041 Hz; DSI(CW vs CCW) L 0.02 R 0.03; [A] turn CW 1.35 CCW -0.49
    == bridge OFF (control), DNg02 tonic 0.5 mV/ms; set validated; backend cpu; hold per frame
       drum ω=1: [A] HS L 1.672 R 0.121 turn 1.353 | [B] HS 0.0/0.0 Hz, DNg02 29.41/29.98 Hz, wing MN 56.71/54.33 Hz, DNa02 14.2/7.4 Hz, 1252 spikes/frame
          relays: PS080 8.1/16.2 Hz, OA-VUMa4 32.1 Hz, GNG286 13.4/12.1 Hz
       drum ω=-1: [A] HS L 0.463 R 0.964 turn -0.488 | [B] HS 0.0/0.0 Hz, DNg02 29.95/29.90 Hz, wing MN 57.93/56.03 Hz, DNa02 13.5/11.8 Hz, 1142 spikes/frame
          relays: PS080 5.6/14.7 Hz, OA-VUMa4 26.0 Hz, GNG286 12.5/12.6 Hz
       still: [B] DNg02 28.45/27.93 Hz, HS 0.0/0.0 Hz, wing MN 57.05/54.21 Hz, 913 spikes/frame
       DNg02 L−R: CW -0.571 Hz, CCW 0.049 Hz; DSI(CW vs CCW) L -0.01 R 0.00; [A] turn CW 1.35 CCW -0.49
    VERDICT FAIL: best gain 2 / DNg02 tonic 0.5: DNg02 lateralised false, DSI 0.03 (target > 0.3; control 0.01); loom → DNp01 null

## JavaScript LIF, dev VM: fine tonic sweep 0.36 / 0.40 / 0.44

    error (ignored): error: SQLite database '~/.cache/nix/eval-cache-v5/4a7049e908bd831cd66e4988e3346c0542661679a461d95c7f2e1f8d09fa6526.sqlite' is busy
    == bridge on, gain 2, DNg02 tonic 0.36 mV/ms; set validated; backend cpu; hold per frame
       drum ω=1: [A] HS L 1.672 R 0.121 turn 1.353 | [B] HS 117.9/0.0 Hz, DNg02 14.39/15.08 Hz, wing MN 47.94/45.73 Hz, DNa02 19.4/10.4 Hz, 932 spikes/frame
          relays: PS080 13.0/11.4 Hz, OA-VUMa4 23.0 Hz, GNG286 8.9/8.9 Hz
       drum ω=-1: [A] HS L 0.463 R 0.964 turn -0.488 | [B] HS 14.3/46.0 Hz, DNg02 16.23/17.79 Hz, wing MN 50.04/48.21 Hz, DNa02 25.6/12.1 Hz, 1346 spikes/frame
          relays: PS080 13.6/25.4 Hz, OA-VUMa4 43.3 Hz, GNG286 21.0/16.7 Hz
       still: [B] DNg02 12.69/13.36 Hz, HS 0.0/0.0 Hz, wing MN 45.24/43.84 Hz, 443 spikes/frame
       DNg02 L−R: CW -0.698 Hz, CCW -1.556 Hz; DSI(CW vs CCW) L -0.06 R -0.08; [A] turn CW 1.35 CCW -0.49
    == bridge on, gain 2, DNg02 tonic 0.4 mV/ms; set validated; backend cpu; hold per frame
       drum ω=1: [A] HS L 1.672 R 0.121 turn 1.353 | [B] HS 117.7/0.2 Hz, DNg02 19.31/19.97 Hz, wing MN 51.35/48.91 Hz, DNa02 24.8/9.9 Hz, 1030 spikes/frame
          relays: PS080 14.1/15.9 Hz, OA-VUMa4 26.8 Hz, GNG286 13.4/12.1 Hz
       drum ω=-1: [A] HS L 0.463 R 0.964 turn -0.488 | [B] HS 14.3/45.9 Hz, DNg02 20.13/19.82 Hz, wing MN 50.25/48.18 Hz, DNa02 10.3/11.5 Hz, 1027 spikes/frame
          relays: PS080 6.0/13.3 Hz, OA-VUMa4 23.4 Hz, GNG286 10.6/9.9 Hz
       still: [B] DNg02 18.33/18.69 Hz, HS 0.0/0.0 Hz, wing MN 48.14/45.89 Hz, 679 spikes/frame
       DNg02 L−R: CW -0.655 Hz, CCW 0.302 Hz; DSI(CW vs CCW) L -0.02 R 0.00; [A] turn CW 1.35 CCW -0.49
    == bridge on, gain 2, DNg02 tonic 0.44 mV/ms; set validated; backend cpu; hold per frame
       drum ω=1: [A] HS L 1.672 R 0.121 turn 1.353 | [B] HS 117.7/0.0 Hz, DNg02 25.12/24.58 Hz, wing MN 54.95/53.09 Hz, DNa02 15.8/8.7 Hz, 1085 spikes/frame
          relays: PS080 12.9/14.0 Hz, OA-VUMa4 26.6 Hz, GNG286 13.8/11.4 Hz
       drum ω=-1: [A] HS L 0.463 R 0.964 turn -0.488 | [B] HS 14.3/46.2 Hz, DNg02 25.12/25.60 Hz, wing MN 55.97/53.45 Hz, DNa02 22.0/12.1 Hz, 1309 spikes/frame
          relays: PS080 10.5/19.3 Hz, OA-VUMa4 38.5 Hz, GNG286 17.4/17.8 Hz
       still: [B] DNg02 26.84/26.13 Hz, HS 0.0/0.0 Hz, wing MN 57.31/54.97 Hz, 1503 spikes/frame
       DNg02 L−R: CW 0.548 Hz, CCW -0.481 Hz; DSI(CW vs CCW) L 0.00 R -0.02; [A] turn CW 1.35 CCW -0.49
    == bridge OFF (control), DNg02 tonic 0.44 mV/ms; set validated; backend cpu; hold per frame
       drum ω=1: [A] HS L 1.672 R 0.121 turn 1.353 | [B] HS 0.0/0.0 Hz, DNg02 23.20/22.47 Hz, wing MN 51.93/49.06 Hz, DNa02 6.1/8.5 Hz, 454 spikes/frame
          relays: PS080 0.0/0.0 Hz, OA-VUMa4 0.0 Hz, GNG286 0.0/0.0 Hz
        #error = new ProtocolError();
    ProtocolError: Protocol error (Runtime.callFunctionOn): Execution context was destroyed.

## JavaScript LIF, dev VM: the full input set (1,114 LPTC + looming cells) as the bridge

    == bridge on, gain 2, DNg02 tonic 0.5 mV/ms; set inputs; backend cpu; hold per frame
       cpu, 1114 bridge cells, ready in 10 s
       drum ω=1: [A] HS L 1.672 R 0.121 turn 1.353 | [B] HS 116.4/0.0 Hz, DNg02 30.64/30.78 Hz, wing MN 58.28/55.54 Hz, turn DN 17.97/3.93 Hz, 1860 spikes/frame

## Isolated circuit: three left HS cells of [B] driven by constant current, nothing else (bench/hs-inject.mjs)

PS080_L input by presynaptic type and sign (+ ACh/monoamine, − GABA/glutamate), then rates averaged over the second half of 1 s:

    PS080_L (1 cell) input 4495 synapses; top: PS118_L-:163  PS057_L-:153  PS333_R+:150  PLP228_R+:147  PS090_L-:138  LAL061_L-:136  LAL156_a_R+:136  PS232_R+:130  PS112_L-:124  LAL019_L+:103  LAL126_R-:94  PLP208_R+:89  PS221_L+:89  LAL133_e_L-:86
      excitatory 2730, inhibitory 1752
    
    == DNg02 tonic 0 mV/ms, HS_L current 0 mV/ms (1 s, 0 spikes)
       HS L/R 0.0/0.0  PS080 L/R 0.0/0.0  OA-VUMa4 0.0  GNG286 L/R 0.0/0.0  DNp15_L 0.0  LPT114_L 0.0  PS321_L 0.0
       DNg02 L/R 0.0/0.0  DNa02 L/R 0.0/0.0
    
    == DNg02 tonic 0 mV/ms, HS_L current 1.5 mV/ms (1 s, 59611 spikes)
       HS L/R 128.8/0.0  PS080 L/R 24.0/12.2  OA-VUMa4 20.0  GNG286 L/R 20.1/10.2  DNp15_L 80.2  LPT114_L 0.0  PS321_L 48.7
       DNg02 L/R 2.7/3.5  DNa02 L/R 26.1/6.1
    
    == DNg02 tonic 0.4 mV/ms, HS_L current 0 mV/ms (1 s, 32592 spikes)
       HS L/R 0.0/0.0  PS080 L/R 6.0/4.0  OA-VUMa4 14.0  GNG286 L/R 6.0/4.0  DNp15_L 0.0  LPT114_L 0.2  PS321_L 0.0
       DNg02 L/R 17.4/17.4  DNa02 L/R 2.8/6.8
    
    == DNg02 tonic 0.4 mV/ms, HS_L current 1.5 mV/ms (1 s, 78650 spikes)
       HS L/R 129.7/0.0  PS080 L/R 19.6/19.8  OA-VUMa4 36.9  GNG286 L/R 17.8/13.5  DNp15_L 76.8  LPT114_L 1.3  PS321_L 42.9
       DNg02 L/R 19.2/18.4  DNa02 L/R 24.4/13.8
    
    == DNg02 tonic 0.5 mV/ms, HS_L current 0 mV/ms (1 s, 82435 spikes)
       HS L/R 0.0/0.0  PS080 L/R 10.0/20.5  OA-VUMa4 40.5  GNG286 L/R 16.8/16.8  DNp15_L 0.0  LPT114_L 0.0  PS321_L 0.0
       DNg02 L/R 32.2/30.6  DNa02 L/R 29.9/12.4
    
    == DNg02 tonic 0.5 mV/ms, HS_L current 1.5 mV/ms (1 s, 66671 spikes)
       HS L/R 128.6/0.0  PS080 L/R 14.5/11.8  OA-VUMa4 31.6  GNG286 L/R 18.8/14.2  DNp15_L 77.8  LPT114_L 2.2  PS321_L 45.2
       DNg02 L/R 29.7/29.8  DNa02 L/R 38.3/4.2

## Two-hop wiring HS → relay → DNg02 in [B] (bench/paths.mjs)

    == HS cells and their strongest outgoing targets (synapses, sign of HS = 1)
      HSN_R (10015): 737 syn to 79 targets; DNp15_R:138 GNG647_R:54 OCC02a_R:44 GNG283_R:39 PS324_R:30 DNp18_R:28 PS321_L:28 PS324_L:27
      HSE_R (10016): 848 syn to 89 targets; DNp15_R:122 GNG283_R:69 PS321_R:66 PS324_R:52 PS072_R:52 PS324_L:51 PS321_L:39 PS047_b_R:31
      HSS_R (10023): 1238 syn to 150 targets; LPT114_R:89 LoVC15_R:59 PS013_R:48 PS047_b_R:48 PS072_R:43 DNg41_R:37 DNa02_R:36 PS070_R:36
      HSE_L (10034): 563 syn to 81 targets; DNp15_L:78 GNG283_L:54 PS321_L:47 PS072_L:34 PS324_L:32 PS321_R:27 LPT114_L:27 PS324_R:24
      HSN_L (10181): 614 syn to 70 targets; DNp15_L:126 GNG647_L:37 GNG283_L:35 OCC02a_L:34 PS321_L:32 DNp18_L:26 DNae002_L:26 PS321_R:19
      HSS_L (10419): 1173 syn to 144 targets; LPT114_L:79 PS321_L:59 LoVC15_L:49 PS072_L:48 DNa02_L:47 CvN6_R:44 PLP256_L:37 DNp18_L:36
    
    == two-hop HS -> relay -> DNg02: relays ranked by min(HS->relay, relay->DNg02) synapses
      HSS_R -> PS080_R(-) -> DNg02_L: 168 / 152
      HSN_L -> PS080_L(-) -> DNg02_R: 126 / 172
      HSS_L -> PS080_L(-) -> DNg02_R: 112 / 172
      HSS_L -> GNG286_L(+) -> DNg02_R: 35 / 191
      HSS_L -> PS345_L(-) -> DNg02_R: 34 / 65
      HSN_R -> PS080_R(-) -> DNg02_L: 32 / 152
      HSS_R -> OA-VUMa4_M(+) -> DNg02_R: 91 / 28
      HSS_L -> OA-VUMa4_M(+) -> DNg02_R: 125 / 28
      HSE_R -> PS080_R(-) -> DNg02_L: 24 / 152
      HSE_L -> PS306_L(-) -> DNg02_L: 24 / 24
      HSE_L -> PS080_L(-) -> DNg02_R: 21 / 172
      HSE_R -> OA-VUMa4_M(+) -> DNg02_R: 19 / 28
      HSS_R -> GNG286_R(+) -> DNg02_L: 18 / 197
      HSN_L -> PS137_L(-) -> DNg02_L: 17 / 55
      HSS_L -> LAL084_L(-) -> DNg02_R: 20 / 16
      HSS_R -> WED071_R(-) -> DNg02_L: 16 / 15
    
    == direct HS -> DNg02 synapses: 0
    
    == DNg02_L (15 cells) input: 17311 synapses; top presynaptic types:
      IB008_L-:429  DNp54_L-:322  PS117_b_L-:314  AN07B004_R+:306  PS041_L+:301  AN07B004_L+:263  IB008_R-:217  GNG544_R+:217  LAL197_R+:210  GNG286_R+:197  IB025_L+:193  PS117_a_L-:174  AN06B040_L-:172  PS005_a_R-:172  PS142_L-:167  IN03B043_L-:159  CL216_R+:157  PS005_a_L-:153
    
    == DNg02_R (14 cells) input: 17896 synapses; top presynaptic types:
      PS117_b_R-:389  IB008_R-:335  AN07B004_L+:325  AN07B004_R+:299  PS041_R+:257  IB008_L-:242  GNG544_L+:226  LAL197_L+:224  AN06B040_L-:215  DNp54_R-:212  DNp54_L-:210  CL309_L+:194  GNG286_L+:191  CL216_R+:186  IB025_L+:185  CB0630_R+:176  PS080_L-:172  IB010_R-:168
