import { Injectable, Logger } from "@nestjs/common";
import { Resend } from "resend";

@Injectable()
export class EmailService {
  private readonly resend: Resend | null;
  private readonly from: string;
  private readonly logger = new Logger(EmailService.name);

  constructor() {
    const apiKey = process.env.RESEND_API_KEY;
    if (apiKey) {
      this.resend = new Resend(apiKey);
    } else {
      this.resend = null;
      this.logger.warn(
        "RESEND_API_KEY is not set — email sending is disabled."
      );
    }
    this.from = process.env.EMAIL_FROM ?? "Should I? <hello@shouldi.fun>";
  }

  // ── Shared HTML utilities ────────────────────────────────────────────────────

  private baseTemplate(content: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Should I?</title>
</head>
<body style="margin:0;padding:0;background:#09090B;font-family:'DM Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#09090B;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;">
          <tr>
            <td style="padding:0 24px 24px;">
              <span style="font-size:24px;font-weight:800;color:#A78BFA;letter-spacing:-0.5px;">Should I?</span>
            </td>
          </tr>
          <tr>
            <td style="background:#18181B;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:32px 28px;">
              ${content}
            </td>
          </tr>
          <tr>
            <td style="padding:24px 24px 0;text-align:center;">
              <p style="font-size:12px;color:#52525B;margin:0;">
                shouldi.fun &nbsp;·&nbsp;
                <a href="https://shouldi.fun/privacy" style="color:#52525B;">Privacy</a>
                &nbsp;·&nbsp;
                <a href="https://shouldi.fun/terms" style="color:#52525B;">Terms</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  private ctaButton(label: string, href: string): string {
    return `<a href="${href}" style="display:inline-block;background:#A78BFA;color:#ffffff;font-weight:700;font-size:15px;padding:14px 28px;border-radius:12px;text-decoration:none;letter-spacing:-0.2px;">${label}</a>`;
  }

  private resultBar(yesPercent: number): string {
    const noPercent = 100 - yesPercent;
    return `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 8px;">
      <tr>
        <td width="${yesPercent}%" style="height:14px;background:#22C55E;border-radius:${yesPercent > 95 ? "7px" : "7px 0 0 7px"};"></td>
        <td width="1px" style="height:14px;background:rgba(255,255,255,0.3);"></td>
        <td width="${noPercent}%" style="height:14px;background:#EF4444;border-radius:${noPercent > 95 ? "7px" : "0 7px 7px 0"};"></td>
      </tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="font-size:13px;color:#22C55E;font-weight:700;">YES ${yesPercent}%</td>
        <td align="right" style="font-size:13px;color:#EF4444;font-weight:700;">${noPercent}% NO</td>
      </tr>
    </table>`;
  }

  // ── Email 1: Welcome ──────────────────────────────────────────────────────────

  async sendWelcomeEmail(to: string, name?: string | null): Promise<void> {
    const firstName = name?.split(" ")[0] ?? "there";

    const html = this.baseTemplate(`
    <h1 style="margin:0 0 8px;font-size:26px;font-weight:800;color:#FAFAFA;letter-spacing:-0.5px;">
      Welcome${firstName !== "there" ? `, ${firstName}` : ""}. 👋
    </h1>
    <p style="margin:0 0 24px;font-size:15px;color:#A1A1AA;line-height:1.6;">
      The crowd is already voting. Post your first question — anything
      you want a YES or NO on — and thousands of people will weigh in.
    </p>
    <p style="margin:0 0 28px;font-size:15px;color:#A1A1AA;line-height:1.6;">
      Anonymous. Free. No followers needed. Just the crowd, deciding.
    </p>
    ${this.ctaButton("See what's trending →", "https://shouldi.fun/feed")}
    <p style="margin:28px 0 0;font-size:13px;color:#52525B;">
      You're receiving this because you signed up with this email address.
    </p>
  `);

    if (!this.resend) return;
    try {
      await this.resend.emails.send({
        from: this.from,
        to,
        subject: "Welcome to Should I? 👋",
        html,
      });
    } catch (err: unknown) {
      console.error("[email] Welcome send failed:", err instanceof Error ? err.message : err);
    }
  }

  // ── Email 2: Result ───────────────────────────────────────────────────────────

  async sendResultEmail(data: {
    to: string;
    questionText: string;
    questionId: string;
    yesPercent: number;
    totalVotes: number;
  }): Promise<void> {
    const { to, questionText, questionId, yesPercent, totalVotes } = data;
    const noPercent = 100 - yesPercent;
    const dominantSide = yesPercent >= 50 ? "YES" : "NO";
    const dominantPct = yesPercent >= 50 ? yesPercent : noPercent;
    const dominantColor = yesPercent >= 50 ? "#22C55E" : "#EF4444";
    const isClose = yesPercent >= 44 && yesPercent <= 56;

    const verdict = isClose
      ? `The world was split — ${yesPercent}% YES, ${noPercent}% NO.`
      : `${dominantPct}% said <span style="color:${dominantColor};font-weight:700;">${dominantSide}</span>.`;

    const html = this.baseTemplate(`
    <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#52525B;letter-spacing:1.2px;text-transform:uppercase;">
      Your question closed
    </p>
    <h1 style="margin:0 0 20px;font-size:20px;font-weight:800;color:#FAFAFA;line-height:1.3;letter-spacing:-0.3px;">
      "${questionText}"
    </h1>
    <p style="margin:0 0 4px;font-size:22px;font-weight:800;color:#FAFAFA;">
      ${verdict}
    </p>
    <p style="margin:0 0 4px;font-size:13px;color:#52525B;">
      ${totalVotes.toLocaleString()} people voted
    </p>
    ${this.resultBar(yesPercent)}
    <div style="margin:28px 0;">
      ${this.ctaButton("See the full result →", `https://shouldi.fun/q/${questionId}`)}
    </div>
    <p style="margin:0;font-size:13px;color:#52525B;">
      Share your result — let more people weigh in.
    </p>
  `);

    const subject = isClose
      ? `The world couldn't decide: "${questionText.slice(0, 50)}${questionText.length > 50 ? "…" : ""}"`
      : `${dominantPct}% said ${dominantSide}: results are in`;

    if (!this.resend) return;
    try {
      await this.resend.emails.send({ from: this.from, to, subject, html });
    } catch (err: unknown) {
      console.error("[email] Result send failed:", err instanceof Error ? err.message : err);
    }
  }

  // ── Email 3: Re-engagement ────────────────────────────────────────────────────

  async sendReEngagementEmail(data: {
    to: string;
    trendingQuestion: { text: string; id: string; yesPercent: number; totalVotes: number };
  }): Promise<void> {
    const { to, trendingQuestion: q } = data;
    const truncated = q.text.length > 90 ? q.text.slice(0, 90) + "…" : q.text;

    const html = this.baseTemplate(`
    <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#52525B;letter-spacing:1.2px;text-transform:uppercase;">
      Right now on Should I?
    </p>
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:800;color:#FAFAFA;line-height:1.3;letter-spacing:-0.3px;">
      "${truncated}"
    </h1>
    <p style="margin:0 0 4px;font-size:15px;color:#A1A1AA;">
      <span style="color:#22C55E;font-weight:700;">${q.yesPercent}% say YES</span> —
      ${q.totalVotes.toLocaleString()} people have voted.
    </p>
    ${this.resultBar(q.yesPercent)}
    <div style="margin:28px 0;">
      ${this.ctaButton("Vote now →", `https://shouldi.fun/q/${q.id}`)}
    </div>
    <p style="margin:0;font-size:13px;color:#52525B;">
      Thousands of questions are waiting for your take.
    </p>
  `);

    if (!this.resend) return;
    try {
      await this.resend.emails.send({
        from: this.from,
        to,
        subject: `People can't agree: "${truncated}"`,
        html,
      });
    } catch (err: unknown) {
      console.error("[email] Re-engagement send failed:", err instanceof Error ? err.message : err);
    }
  }
}
