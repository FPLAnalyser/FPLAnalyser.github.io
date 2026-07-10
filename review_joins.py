import pandas as pd
from source_join.names import similarity

unc = pd.read_csv("data/join_uncertain.csv").drop_duplicates(
    subset=["source", "source_id"])
ss = pd.read_csv("season_summary.csv")

print("For each uncertain player, pick the correct candidate and copy that")
print("line into data/player_overrides.csv (create it with header shown):\n")
print("source,source_id,fpl_id\n" + "=" * 60)
for _, r in unc.iterrows():
    cands = ss[ss["team_short"] == r["source_team"]].copy()
    full = cands["first_name"].fillna("") + " " + cands["second_name"].fillna("")
    cands["sim"] = [similarity(r["source_name"], f) for f in full]
    cands = cands.sort_values("sim", ascending=False).head(3)
    print(f"\n{r['source']} sees: {r['source_name']!r} ({r['source_team']}, "
          f"reason: {r['method']})")
    for _, c in cands.iterrows():
        print(f"  {r['source']},{r['source_id']},{c['id']}"
              f"    <- {c['first_name']} {c['second_name']} ({c['web_name']})")
