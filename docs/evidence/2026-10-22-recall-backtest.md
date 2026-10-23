# Recall -> shortage backtest, run 2026-10-22

Data: openFDA drug shortages (1,609 entries, last_updated 2026-10-22) and drug enforcement reports (18,043 recalls, 2012-2026).
Command: `python3 research/recall_backtest.py <data_dir> <window_days>`

```
window=180d  shortage ingredients posted 2025-26: 142  baseline Rx generics: 357
had a recall of same ingredient in prior window: shortages 12.7%  vs  baseline 13.4%  lift x0.9
...recall by the SAME company that later reported the shortage: 2/142
  everolimus       shortage posted 2025-11-03  recalls before: 5  first 2025-09-05 'Endo USA, Inc.' Class III  'Failed Impurities/Degradation Specifications: Out '
  semaglutide      shortage posted 2026-06-04  recalls before: 5  first 2026-02-13 'Harbin Jixianglong Biotech C' Class II  'CGMP Deviations This recall has been initiated due'
  polyethylene     shortage posted 2026-08-13  recalls before: 4  first 2026-03-03 'K.C. Pharmaceuticals, Inc' Class II  'Lack of Assurance of Sterility'
  acetaminophen    shortage posted 2025-11-03  recalls before: 4  first 2025-05-22 'Aurobindo Pharma USA Inc' Class II  'cGMP deviations: Due to confirmed consumer complai'
  cisatracurium    shortage posted 2026-05-06  recalls before: 3  first 2025-11-26 'SOMERSET THERAPEUTICS LLC' Class III  'Subpotent product:out of specification assay resul'
  ketamine         shortage posted 2025-11-07  recalls before: 3  first 2025-06-02 'Tailstorm Health INC' Class II  'Lack of Assurance of Sterility: A recent FDA inspe'

window=365d  shortage ingredients posted 2025-26: 142  baseline Rx generics: 357
had a recall of same ingredient in prior window: shortages 16.2%  vs  baseline 24.8%  lift x0.7
...recall by the SAME company that later reported the shortage: 3/142
  semaglutide      shortage posted 2026-06-04  recalls before: 22  first 2025-07-09 'Boothwyn Pharmacy LLC' Class II  'Subpotent Drug'
  acetaminophen    shortage posted 2025-11-03  recalls before: 10  first 2024-11-14 'LNK International, Inc.' Class II  'CGMP Deviations: Released product should have been'
  haloperidol      shortage posted 2026-01-09  recalls before: 8  first 2025-03-21 'Somerset Therapeutics Privat' Class II  'Lack of Assurance of Sterility: Media fill with ba'
  everolimus       shortage posted 2025-11-03  recalls before: 5  first 2025-09-05 'Endo USA, Inc.' Class III  'Failed Impurities/Degradation Specifications: Out '
  metoprolol       shortage posted 2026-08-31  recalls before: 5  first 2026-01-29 'Teva Pharmaceuticals USA, In' Class II  'Failed Dissolution Specifications'
  ketamine         shortage posted 2025-11-07  recalls before: 5  first 2024-12-19 'Hikma Injectables USA Inc' Class II  'Lack of Assurance of Sterility: The tamper-evident'

```
