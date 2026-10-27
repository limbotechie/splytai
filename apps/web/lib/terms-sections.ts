export type LegalSection = {
  id: string;
  title: string;
  body: string;
};

export function estimateReadingTime(sections: LegalSection[]): number {
  const totalWords = sections.reduce(
    (sum, s) => sum + s.body.split(/\s+/).length,
    0
  );
  return Math.max(1, Math.round(totalWords / 200));
}

export const termsSections: LegalSection[] = [
  {
    id: "acceptance",
    title: "1. Acceptance of Terms",
    body: `These terms describe the responsibilities and limits of using Splyt for private reimbursement requests. Use the software only if you understand these terms and the privacy policy. Nothing here removes rights or protections that cannot be excluded under applicable law.`,
  },
  {
    id: "description",
    title: "2. Description of Service",
    body: `Splyt helps an organiser who already paid an expense review a receipt, allocate shares, and request reimbursement in ZEC. Participants receive separate private requests. The organiser checks their own wallet and records receipt manually; Splyt does not independently verify payments.`,
  },
  {
    id: "wallets",
    title: "3. Direct Wallet Payments",
    body: `Participants send payments directly to the organiser through their own wallets. Splyt does not hold funds, import wallet keys, submit transactions, or collect an escrow balance. Review the receiving address, amount, network, and wallet fees before sending.\n\nOpening a wallet or copying a payment URI does not confirm a transfer. Splyt cannot choose a wallet's funding inputs, guarantee transaction privacy, reverse a payment, or arrange an automatic refund.`,
  },
  {
    id: "receipt-review",
    title: "4. Receipt Review and Allocations",
    body: `Local receipt recognition is a convenience, not a financial determination. Review item descriptions, currency, totals, taxes, tips, discounts, and each allocation before sharing. You are responsible for agreeing the expense and shares with the people involved.\n\nThe software does not prove that a receipt is genuine, identify a participant, or establish that an allocation is fair. Correct inconsistent or unsupported inputs rather than treating an extracted suggestion as authoritative.`,
  },
  {
    id: "approved-amounts",
    title: "5. Approved Amounts and Exchange Rates",
    body: `Public exchange-rate suggestions are informational and may be unavailable or outdated. The organiser must approve the ZEC amounts or enter them manually. Published requests retain those amounts even when the market price changes; wallet fees are separate.\n\nChanging a published recipient or amount requires cancelling the old unpaid request and issuing a replacement. Reconcile any late payment against the original obligation. Do not request the same reimbursement twice or replace an amount while a payment report remains unresolved.`,
  },
  {
    id: "private-links",
    title: "6. Private Links and Capabilities",
    body: `A private request link grants access to its request; it does not verify the holder's identity. Send each link only to its intended participant. A forwarded link, copied recovery file, or disclosed application key can give another person access to sensitive records.`,
  },
  {
    id: "confirmations",
    title: "7. Reports and Manual Confirmations",
    body: `A participant's payment report is a statement, not evidence of an on-chain transfer. An organiser must check their wallet before recording the amount received. Their confirmation is an acknowledgement, not a cryptographic payment proof or an independent verification.\n\nRecord partial receipts, overpayments, and corrections accurately. A fully received bill means the organiser has acknowledged all requested amounts. Archiving a bill can leave reimbursements outstanding and does not transfer funds.`,
  },
  {
    id: "expiry",
    title: "8. Expiry, Cancellation, and Revocation",
    body: `Expiry disables the normal send action, but cannot stop someone transferring funds later. An authorised participant may report a late transfer while the records remain retained. Cancellation does not erase earlier acknowledgements, and revocation denies future access rather than deleting copies already obtained.`,
  },
  {
    id: "recovery",
    title: "9. Accountless Storage and Recovery",
    body: `The local workspace uses browser storage and AES-GCM encryption without an email account or wallet login. Keep an encrypted recovery export and a strong, separate passphrase. Exports use PBKDF2-HMAC-SHA-256 with 600,000 iterations and a fresh salt to derive their encryption key.\n\nEach export is a snapshot, not continuous backup or automatic discovery of later bills. Refresh and reconcile retained remote revisions before writing from a restored workspace. Splyt cannot recover missing application keys, a lost invitation, or a forgotten recovery passphrase.`,
  },
  {
    id: "retention",
    title: "10. Retention and Deletion",
    body: `Relay retention ends 30 days after the last organiser update. Participant reports do not extend that deadline, which also applies to child requests. Deleting a remote bill and clearing the local workspace are separate actions; either can remove information needed for future access.\n\nExports and recipients' copies may remain readable after remote deletion. Neither deletion nor a retention deadline cancels a transfer, removes blockchain data, or guarantees that another person has erased what they received.`,
  },
  {
    id: "release-limits",
    title: "11. Development and Release Limits",
    body: `This release operates on Zcash testnet only; test coins have no monetary value. Currency estimates use current public CoinGecko market data when the live quote service responds, and must be reviewed before a request is published. Transfers are handed to an external wallet through ZIP 321. Splyt does not broadcast or independently verify transactions; organisers must verify payments in their wallets before confirming them. Address parsing and ZIP 321 handoff have not yet been verified with a live wallet or test-fund transfer for this release.\n\nThis software does not support mainnet or real-money transactions. It is provided as available, without a claim of security audit, uninterrupted service, complete transaction privacy, or protection against a compromised device.`,
  },
  {
    id: "acceptable-use",
    title: "12. Acceptable Use",
    body: `Use only records and capabilities you are authorised to access. Do not impersonate another participant, submit knowingly false payment reports, interfere with the relay, or distribute malicious content. You remain responsible for complying with applicable laws and resolving reimbursement disputes with the people involved.`,
  },
  {
    id: "licences",
    title: "13. Third-Party Components and Licences",
    body: `Splyt retains presentation and software components from third parties. Their applicable licences, copyright notices, and attribution requirements remain in force. These terms do not replace those licences or imply endorsement by a component author, wallet provider, or market-data provider.`,
  },
  {
    id: "changes",
    title: "14. Changes and Further Information",
    body: `Material changes to these terms are reflected in the date shown on this page. Review the documentation and privacy policy for the current workflow, data handling, and recovery limits. No unverified support address or former product account is represented as a contact channel.`,
  },
];
