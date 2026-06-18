# 2026 Spending Evaluation and Budget Reset

Source files:
- `/Users/cox/Downloads/Chase6734_Activity20260101_20260617_20260617.CSV`
- `/Users/cox/Downloads/Chase9872_Activity20260101_20260616_20260616.CSV`
- `/Users/cox/Downloads/Checking - 3795_01-01-2026_06-20-2026.csv`

Analysis period: January-May 2026 as full months. June is partial and is excluded from the monthly run-rate baseline.

## Key Assumptions

- Chase card payments from checking are excluded because card-level transactions are already included.
- LPL withdrawals are treated as savings/retirement transfers, not spending.
- Positive deposits are treated as income/offsets, not spending.
- Recurring checks of `$1,477` (`CHECK #5455`, `#5458`, `#5459`, `#5461`, `#5462`, and June `#5463`) are treated as Tithe/Giving.
- RaiseRight is treated mostly as gas cards and included in Gas/Oil.
- Merchant splits are applied where a merchant mixes categories:
  - Aldi: 100% Groceries
  - Walmart / WM Supercenter: 80% Personal/Toiletries, 10% Medical/Health, 10% Groceries
  - Sam's Club: 75% Groceries, 20% Personal/Toiletries, 5% Clothing
  - Costco: 75% Groceries, 20% Personal/Toiletries, 5% Clothing
  - Target: 100% Retail
- Venmo, Zelle, Splitwise, cash withdrawals, and non-recurring checks remain in review until labeled.

## Headline Run Rate

| Measure | Jan-May Total | Monthly Average |
|---|---:|---:|
| Categorized spending | $48,931 | $9,786 |
| Review-needed spending | $15,445 | $3,089 |
| Total spending / outflow, excluding card payments and savings transfers | $64,376 | $12,875 |
| Savings/retirement transfers | $23,625 | $4,725 |
| Income/deposits/offsets | $82,809 | $16,562 |

## Monthly Spending

| Month | Total Spending | Categorized | Needs Review | Savings Transfers | Income/Deposits |
|---|---:|---:|---:|---:|---:|
| Jan 2026 | $11,453 | $5,945 | $5,509 | $4,500 | $16,068 |
| Feb 2026 | $7,899 | $7,498 | $401 | $4,500 | $14,908 |
| Mar 2026 | $13,359 | $13,266 | $93 | $5,625 | $15,932 |
| Apr 2026 | $10,019 | $9,661 | $358 | $4,500 | $24,910 |
| May 2026 | $21,645 | $12,561 | $9,084 | $4,500 | $10,991 |

## Proposed Monthly Budget

Use this as the new starting budget, then revise after labeling the review items.

| Budget Line | Proposed Monthly Budget | Basis |
|---|---:|---|
| Tithe/Giving | $1,850 | Actual run rate, includes $1,477 monthly check |
| Groceries | $745 | Aldi 100%, Sam's/Costco 75%, Walmart 10%, plus food-store merchants |
| Mortgage | $897 | Fixed actual |
| Restaurants | $380 | Actual run rate |
| Retail | $685 | Actual run rate |
| Travel/Vacation | $735 | Actual run rate, likely lumpy |
| Entertainment | $1,170 | Actual run rate, likely lumpy |
| Phones | $330 | Actual run rate |
| Medical/Health | $295 | Actual run rate plus Walmart 10% split |
| School/Kids | $285 | Actual run rate |
| Electric/Gas Utility | $150 | Actual run rate |
| Internet | $59 | Fixed actual |
| Bills/Utilities | $175 | Actual run rate |
| Insurance | $470 | Actual run rate, lumpy |
| Property Taxes | $535 | Annualized from March payment |
| License/Taxes | $90 | Actual run rate |
| Sports/Recreation | $115 | Actual run rate |
| Clothing | $120 | Actual run rate plus Sam's/Costco 5% split |
| Personal/Toiletries | $345 | Walmart 80% plus Sam's/Costco 20% split |
| Auto Maintenance | $40 | Actual run rate |
| Home/Retail | $35 | Actual run rate |
| Gas/Oil | $235 | Card gas plus RaiseRight gas-card run rate |
| Subscriptions: Spotify, ChatGPT, Streaming, Prime, Kindle | $85 | Actual run rate |
| Bank Fees | $0 | Fees appear offset/waived; do not budget as normal spending |
| Review / Unassigned Cash, Checks, Venmo, Zelle | $3,100 | Temporary placeholder until labeled |
| Savings/Retirement Transfer | $4,725 | Actual transfer run rate |

Budget roll-up:
- Categorized monthly spending target: `$9,826`
- Spending target including temporary review bucket: `$12,926`
- Spending plus savings/retirement transfers: `$17,651`

Grocery correction:
- The earlier `$1,300/mo` grocery estimate was too broad because mixed merchants were treated as all grocery.
- With percentage splits, groceries average about `$742/mo`.
- Key split effects:
  - Aldi to groceries: `$215/mo`
  - Sam's Club to groceries: `$424/mo`, toiletries: `$113/mo`, clothing: `$28/mo`
  - Costco to groceries: `$34/mo`, toiletries: `$9/mo`, clothing: `$2/mo`
  - Walmart to toiletries: `$179/mo`, health: `$22/mo`, groceries: `$22/mo`
  - RaiseRight to Gas/Oil: `$213/mo`

## Items To Label

These items drive most of the uncertainty:

| Date | Amount | Current Bucket | Description |
|---|---:|---|---|
| 2026-05-14 | $9,069 | Checks / Unknown Payee | CHECK #1769 |
| 2026-01-30 | $3,020 | Peer/Cash/Transfer Review | Zelle to Peter Fanous |
| 2026-01-22 | $1,007 | Checks / Unknown Payee | CHECK #5457 |
| 2026-01-26 | $423 | Peer/Cash/Transfer Review | Venmo |
| 2026-01-20 | $400 | Peer/Cash/Transfer Review | Zelle to Peter Fanous |
| 2026-01-28 | $306 | Peer/Cash/Transfer Review | Splitwise |
| 2026-02-27 | $285 | Checks / Unknown Payee | CHECK #5460 |
| 2026-01-20 | $246 | Peer/Cash/Transfer Review | Venmo |
| 2026-04-22 | $230 | Peer/Cash/Transfer Review | Customer withdrawal |
| 2026-04-24 | $30 | Checks / Unknown Payee | CHECK #1768 |

## Succinct Process Going Forward

1. Use only full months for the base budget.
2. Exclude card payments, income, and retirement transfers from spending.
3. Treat fixed recurring items as budget lines, not averages to debate.
4. Put lumpy categories into monthly sinking funds: property tax, insurance, travel, entertainment, medical, auto, school.
5. Maintain one review bucket for unknown checks, Venmo, Zelle, Splitwise, and cash; clear it monthly.
6. Reset the app budget from the proposed monthly budget after the review bucket is labeled.
