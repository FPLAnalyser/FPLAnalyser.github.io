# Getting the domain categorised before launch

Corporate and school networks filter by **category**, not by whether a site is
any good. A domain nobody has classified lands in "Uncategorised", and a domain
registered in the last month lands in "Newly Registered Domain". Both are
blocked by default in most enterprise filters. A lot of FPL happens at a desk
on a weekday lunch break, so this is worth ten minutes.

Where a vendor accepts public submissions they are free, take about a minute,
and are usually actioned in 24–48 hours. Several vendors accept nothing from
non-customers at all — see the table.

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

Not all of these are open to the public. Two are confirmed gated; the rest are
believed open but were **not** verifiable from the dev container, whose proxy
blocks these hosts. Ten-second test in a browser: if the page asks you to sign
in, or says it cannot identify you, it is gated — move on.

| Vendor | Where | Who can submit |
|---|---|---|
| **Fortinet (FortiGuard)** | [fortiguard.com/webfilter](https://www.fortiguard.com/webfilter) | Believed open — look up, submit the rating request with an email. Usually within 24h. |
| **Palo Alto (PAN-DB)** | [urlfiltering.paloaltonetworks.com](https://urlfiltering.paloaltonetworks.com/) | Believed open — search, then **Request Change**. A crawler validates on submission; if it agrees the change lands immediately. |
| **Symantec / Broadcom (WebPulse)** | [sitereview.symantec.com](https://sitereview.symantec.com/) | Believed open — check Category, then the review form. Typically 24–48h. |
| **Cisco Talos** | [talosintelligence.com/reputation_center/web_categorization](https://talosintelligence.com/reputation_center/web_categorization) | Believed open, may want a free Cisco account. Choose **Content**, not Security — the wrong one routes it to the wrong team. |
| **Cloudflare** | [radar.cloudflare.com/domains/feedback](https://radar.cloudflare.com/domains/feedback) | Believed open. Drives Gateway and 1.1.1.1 for Families. Max two content categories. |
| **Zscaler** | [sitereview.zscaler.com](https://sitereview.zscaler.com/) | **Customers only.** Access requires the request to originate from a Zscaler egress IP; submissions from other source IPs are rejected. Nothing to do from outside. |
| **Forcepoint** | [Customer Hub site lookup](https://forcepoint2.my.site.com/ForcepointCustomerHub/s/article/How-To-Submit-Uncategorized-Sites) | **Customers only** — the lookup and recategorisation live behind the Hub login. |
| **Netskope** | — | No public form. Customer-side configuration only. |

Zscaler is the frustrating one, because it is the most common filter in UK
enterprise. There is no way to submit from outside it. What does work is time:
their crawlers categorise domains once there is traffic and inbound linking, so
this resolves itself as the site gets used. If someone whose workplace runs
Zscaler wants to submit it from there, that route exists — but it is their
call, not something to solicit.

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

---

## While it is still blocked: the mirror

Re-categorisation is the real fix but it is not in our gift, and Zscaler — the
filter most likely to be in the way — only takes submissions from inside its
own network. So the same build is also published to a plain `github.io`
address, which measured clean on a corporate network that blocks the custom
domain. The `mirror` job in `.github/workflows/deploy.yml` does it on every
deploy; there is no second build and no code path in the app, so the only way
the mirror goes stale is if that job fails.

**It has to live under a separate organisation.** A custom domain set on an
account's *user* Pages site cascades: GitHub redirects `fplanalyser.github.io`
to `fplanalyser.co.uk`, and every project site on the account is served under
the custom domain too. A second repo on this account would inherit the
redirect and land straight back on the blocked domain. A free org gets its own
`<org>.github.io` and escapes it.

One-time setup, all of it owner-side:

1. Create a free organisation. **The name is public and sits in the URL** — keep
   it brand-neutral, same rules as everywhere else in this repo.
2. In it, create a **public** repo named exactly `<org>.github.io`, then
   Settings → Pages → Source: *Deploy from a branch*, `main`, `/` (root).
3. Give this repo write access to it — a fine-grained PAT scoped to that one
   repo with **Contents: Read and write**, stored here as the secret
   `MIRROR_TOKEN`. Fine-grained tokens expire (366 days maximum), and an
   expired one means a silently stale mirror, so either diarise the renewal or
   use a deploy key, which does not expire.
4. Set the repository variable `MIRROR_REPO` to `<org>/<org>.github.io`. The
   job is skipped entirely while that is unset, so nothing breaks in the
   meantime.
5. Add `https://<org>.github.io` to `ORIGINS` in `worker/fpl-proxy.js` and
   redeploy the Worker. **Skip this and the mirror renders but every live call
   fails** — injuries, suspensions, set-piece order, deadlines and Load Your
   Team all go through that relay, and it echoes back the first allowed origin
   for anything it does not recognise, which the browser then rejects.

Two things the job takes care of, both worth knowing if it is ever rewritten:
it deletes `dist/CNAME` before pushing, because GitHub lets exactly one Pages
site hold a domain and publishing that file on the mirror would pull
`fplanalyser.co.uk` off the real site; and it leaves the canonical tag pointing
at `fplanalyser.co.uk`, so search engines fold the mirror into the real domain
instead of ranking it as a duplicate.

The mirror is a workaround, not a second home. When the category clears, unset
`MIRROR_REPO` and the whole thing stops.
