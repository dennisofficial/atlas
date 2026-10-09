# local-mix-v2b

48 sanitized scopes: 34 creation negatives from v1 plus 7 mixed cases from git history (god-class
positives, a resolution pair, and a cohesive sink). Same cases as v2a; the only change is three
label corrections.

## Label corrections (v2a → v2b)

`LocalGitService`, `GithubPrService`, and `EntityTaskEventSink` carried `expected.impact:
"introduced"` from their original drafting as god-class candidates (provenance `kind:
"positive"`). The blind reviewer adjudicated all three down to negatives — `currentConcern:
false`, `notificationWarranted: false` — with rationales that explicitly clear them of any
responsibility mix ("One reason to change"; "Not a violation"; "Tightly cohesive"). Under the
rubric's own definition of `introduced` ("the edit created a mix of independently changing
responsibilities that BEFORE did not have"), a cleared concern on a newly created cohesive scope
is `unchanged`, not `introduced`. The impact field was not updated when the adjudication landed;
v2b corrects that bookkeeping error. Rationales and provenance are unchanged from v2a.

This is a development pilot, not calibrated, and does not justify enabling the feature.
