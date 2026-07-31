# Getting the domain categorised before launch

Corporate and school networks filter by **category**, not by whether a site is
any good. A domain nobody has classified lands in "Uncategorised", and a domain
registered in the last month lands in "Newly Registered Domain". Both are
blocked by default in most enterprise filters. A lot of FPL happens at a desk
on a weekday lunch break, so this is worth ten minutes.

Submissions are free, take about a minute each, and are usually actioned in
24–48 hours.

---

## The thing that actually matters: do not get filed under Gambling

This is a bigger risk than staying uncategorised, and it is specific to this
site.

An automated crawler reading these pages finds **"clean-sheet odds"**,
**"market-implied"** and **"fantasy"** all over the GW Preview, Fixtures and
the player pages. That is a plausible route to a **Gambling** classification —
and Gambling is blocked far harder, and in far more places, than Uncategorised
ever is. Schools block it universally. It would also make the site
unadvertisable on most networks and awkward for anyone linking to it.

The site is genuinely not a gambling site, and can say so truthfully:

- no bookmaker links, no affiliate links, no referral codes
- nothing is for sale and no money changes hands anywhere on the site
- odds are used only as a **model input** — market-implied probabilities feed
  the clean-sheet and expected-points numbers. No betting market is displayed,
  quoted or linked
- the subject is Fantasy Premier League, a free game

Lead with that in every submission. Ask for **Sports** first.

---

## Use the role address, not the personal one

Every form asks for an email to notify. That address becomes associated with
the domain in a vendor's records and sometimes in a reviewer-visible ticket.

Use **fpl.analyser1@gmail.com**. Never the personal address. The WHOIS is
already redacted and the whole point of that work was to keep the two apart —
this is exactly the kind of side channel that undoes it.

---

## Where to submit

Request **Sports** as the primary category. Where a second is allowed, use the
vendor's nearest equivalent of *Recreation / Hobbies / Reference*. Avoid
anything named Games where the taxonomy also uses Games for gambling.

| Vendor | Where | Notes |
|---|---|---|
| **Zscaler** | [sitereview.zscaler.com](https://sitereview.zscaler.com/) | Very common in UK enterprise. Look up the domain, then request a change; up to three suggested categories. |
| **Symantec / Broadcom (WebPulse)** | [sitereview.symantec.com](https://sitereview.symantec.com/) | Check Category, then fill the review form. Typically updated in 24–48h. Follow-ups: site.review@broadcom.com |
| **Palo Alto (PAN-DB)** | [urlfiltering.paloaltonetworks.com](https://urlfiltering.paloaltonetworks.com/) | Search, then **Request Change**. A crawler validates immediately — if it agrees, the change lands straight away. |
| **Fortinet (FortiGuard)** | [fortiguard.com/webfilter](https://www.fortiguard.com/webfilter) | Look up, then submit the rating request. Usually within 24h. |
| **Cisco Talos** | [talosintelligence.com/reputation_center/web_categorization](https://talosintelligence.com/reputation_center/web_categorization) | Choose **Content**, not Security — the wrong one routes it to the wrong team. |
| **Forcepoint** | [Site Lookup on the Customer Hub](https://forcepoint2.my.site.com/ForcepointCustomerHub/s/article/How-To-Submit-Uncategorized-Sites) | Analyze, then Recategorization. |
| **Cloudflare** | [radar.cloudflare.com/domains/feedback](https://radar.cloudflare.com/domains/feedback) | Drives Gateway and 1.1.1.1 for Families. Max two content categories. |

Netskope has no public self-serve form — it is customer-side configuration, so
there is nothing to submit. Skip it.

---

## Wording to paste

> fplanalyser.co.uk is an independent statistics and analysis site for Fantasy
> Premier League, a free game run by the Premier League. It publishes player
> ratings, fixture difficulty, and pre-gameweek analysis.
>
> Please categorise it as **Sports**.
>
> It is not a gambling site. There are no bookmaker links, affiliate links or
> referral codes, nothing is for sale, and no money changes hands anywhere on
> the site. Market-implied probabilities are used only as an input to the
> clean-sheet and expected-points models; no betting market is displayed,
> quoted or linked. Please do not classify it under Gambling.

---

## Afterwards

- **Re-check in a week.** The same lookup tools show the current category, so
  the check is the same page as the submission.
- **Newly-registered blocks expire on their own**, typically at 30 days. If
  something still fails after that and the category reads Sports everywhere,
  the cause is elsewhere — see the TLS note below.
- **Not every block is a category block.** One work laptop failed with
  `ERR_SSL_VERSION_OR_CIPHER_MISMATCH` against `fplanalyser.github.io` as well
  as the custom domain, which rules out the domain, the DNS and the
  certificate: that machine cannot complete a TLS handshake with GitHub Pages
  at all. Nothing on this side is configurable — Pages gives no control over
  protocol versions or cipher suites. The only lever would be moving the
  hosting behind Cloudflare, which is a post-launch decision and wants evidence
  from analytics first, not one anecdote.
