# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/prasadreddys/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/prasadreddys/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: a Node program that scores 758 DefiLlama protocols from a sealed snapshot and ranks the 178 genuine pre-token candidates by an implied value from TVL, seven-day growth and age with no token, each with a concrete seven-step farm plan, on a dashboard with a live model lab.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
```

`main.ts` (Node 22, standard library only) reads the sealed snapshot, writes
`board.json` (the ranked board), `data.js` (the dashboard's data), copies
`dashboard/` and `screenshots/`, and writes `dossier.json` with the vendored
`vendor/makefun-board.ts` library.

The model (radar-2, stated in full on the dashboard): `implied = round(200 x
tvl_usd^0.7 x (1 + clamp(change_7d, -50, 150) / 100) x (0.7 + min(age_days,
1460) / 1460 x 0.65) x (1 + 0.02 x min(chains, 6)))`. TVL is dampened with a
power below one; growth is clamped so one wild week cannot make or break a
row; age is the time since first listing. No protocol name is special-cased.

---

<sub>Entered on [make.fun](https://make.fun/?ref=95gaw808&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
