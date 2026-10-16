# Code signing for the Windows installer: options and costs (October 2026)

Written for the owner, before deciding whether to buy anything.

**What has not been done:** nothing has been bought, no account has been created and no identity document has been sent. Sources were checked on 2026-10-15 on the providers' own pages, linked below. Prices exclude VAT unless stated, and can change: check again before buying.

## 1. What signing changes, and what it does not

- **Today (unsigned):** Windows shows "Windows protected your PC" with **Unknown publisher**. The person installing clicks **More info → Run anyway**.
- **Signed:** Windows shows the **verified publisher name**, and any change to the signed installer breaks the signature visibly.
- **What signing does not do:** Microsoft says a newly signed program can **still** show a SmartScreen warning "until its hash or publisher certificate accumulates sufficient evidence of positive reputation". That "can take several weeks and hundreds of clean installs from a wide audience" ([Microsoft: SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation), updated 2026).
  - With one shop and a few installations, that reputation will build slowly, if at all.
- **EV certificates no longer help.** In Microsoft's words: "EV certificates no longer bypass SmartScreen … Paying a premium for EV solely to avoid SmartScreen warnings is no longer justified" (same page).
- **Certificates now last at most 460 days**, OV and EV alike. This applies to certificates issued from 1 March 2026 ([CA/Browser Forum ballot CSC-31](https://cabforum.org/2025/11/17/ballot-csc-31-maximum-validity-reduction)). Multi-year purchases are delivered as free re-issues.
- **The private key must be kept in certified hardware or a cloud signing service.** Plain certificate files are no longer issued.

## 2. Options

| Option                                                    | Who can get it                                                                                                                                                                                                                                                    | Price (official page)                                                                                                                                                                                                                                              | How signing works                                                                          | Fit for HeroMarket                                                                                                                          |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Microsoft Artifact Signing** (formerly Trusted Signing) | Organisations in the USA, Canada, EU, UK, Australia, New Zealand, Japan, South Korea, Singapore, Switzerland, Norway, Israel; individuals only in the USA or Canada ([Microsoft quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)) | From **$9.99 / month** (Basic, 5,000 signatures) ([Microsoft](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation), [pricing](https://azure.microsoft.com/pricing/details/trusted-signing/)); needs a paid Azure subscription | Cloud. Works directly from the GitHub release workflow. No token.                          | **Not available** to a business or person in Egypt. Only an option if the publisher is a company registered in one of the listed countries. |
| **SSL.com OV** (organisation)                             | A registered business, after checking its registration documents ([SSL.com](https://www.ssl.com/code-signing-certificates/code-signing/buy/))                                                                                                                     | **$129 / year** (1 year; down to $96.75 / year for 5 years). Cloud signing (eSigner) from **$20 / month or $180 / year** ([eSigner pricing](https://ssl.com/guide/esigner-pricing-for-code-signing/)), or a YubiKey token for **+$379**                            | eSigner works from the GitHub release workflow. The token needs the PC it is plugged into. | Works for a registered Egyptian business. About **$309 per year** with cloud signing.                                                       |
| **Certum Standard Code Signing in the Cloud**             | A person, a person with their organisation, or an organisation (the certificate can carry any of these) ([Certum](https://shop.certum.eu/standard-code-signing-in-the-cloud.html))                                                                                | **From €209** (gross; the page does not say for which period). Card-and-reader set **€169**.                                                                                                                                                                       | SimplySign app on the signing PC, with a code from a phone. Hard to automate in CI.        | The cheapest route for a person, but signing becomes a manual step on one PC.                                                               |
| **Stay unsigned**                                         | —                                                                                                                                                                                                                                                                 | **0**                                                                                                                                                                                                                                                              | —                                                                                          | The current state. "More info → Run anyway" once per installation.                                                                          |

Not considered:

- **EV certificates:** they cost more and no longer change SmartScreen (Microsoft, above).
- **Open-source certificates** (for example Certum, €49): only for public open-source projects. HeroMarket is not open source.
- **Self-signed certificates:** Windows treats them like unsigned files.

## 3. Recommendation

**For one shop: stay unsigned for now.** Signing would replace "Unknown publisher" with your name, but it would not remove the warning for a program installed on so few PCs. The installer's integrity is already published as a SHA-256 checksum with each release. The packaged program refuses a modified package header, and Program Files can only be changed by an administrator (D-052).

**When HeroMarket is installed in several shops,** or a shop's IT policy blocks unsigned programs:

- **If the publisher is a registered business:** buy **SSL.com OV with eSigner** (about $309 per year), so the release workflow signs automatically.
- **If the publisher is a person:** buy **Certum Standard in the Cloud** (from €209) and accept a manual signing step.
- **If the business is ever registered in one of Microsoft's listed countries:** prefer **Artifact Signing** ($9.99 per month).

**What you would need to provide (for later):** business registration documents (OV) or a government ID and proof of address (person), and an email address on the business domain for OV. The publisher name shown in Windows is the validated legal name; it cannot be changed to "Hero Market" unless that is the registered name.

**What has to change in the code when you decide:** add the signing step to `.github/workflows/release.yml` (eSigner or Artifact Signing), or sign by hand before publishing (Certum). Then check the result with `Get-AuthenticodeSignature` ([SECURITY_AND_RELEASE.md](SECURITY_AND_RELEASE.md)).
