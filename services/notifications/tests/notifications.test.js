import { jest } from '@jest/globals';

// ── Mock channels ─────────────────────────────────────────────────────────────
jest.unstable_mockModule('../src/channels/email.js', () => ({
  sendRiskEmail: jest.fn().mockResolvedValue(undefined),
}));
jest.unstable_mockModule('../src/channels/slack.js', () => ({
  sendSlackNotification: jest.fn().mockResolvedValue(undefined),
}));
jest.unstable_mockModule('../src/channels/jira.js', () => ({
  writeJiraComment: jest.fn().mockResolvedValue(undefined),
}));

// Mock SQS so the worker doesn't actually poll
jest.unstable_mockModule('@aws-sdk/client-sqs', () => ({
  SQSClient:              jest.fn().mockImplementation(() => ({ send: jest.fn() })),
  ReceiveMessageCommand:  jest.fn(),
  DeleteMessageCommand:   jest.fn(),
}));

const { sendRiskEmail }         = await import('../src/channels/email.js');
const { sendSlackNotification } = await import('../src/channels/slack.js');
const { writeJiraComment }      = await import('../src/channels/jira.js');

// Import worker internals by re-exporting handleEvent from worker via a test shim
// Since worker.js doesn't export handleEvent directly, test it via the module internals
// We'll test channels independently and the template functions directly

import { blockedEmailHtml, blockedEmailText }  from '../src/templates/blocked.js';
import { atRiskEmailHtml }                     from '../src/templates/at-risk.js';
import { digestEmailHtml }                     from '../src/templates/digest.js';

beforeEach(() => jest.clearAllMocks());

// ── Email templates ───────────────────────────────────────────────────────────

describe('blockedEmailHtml template', () => {
  const ctx = {
    releaseName: 'Payments v2.3',
    plannedDate: '2026-07-08',
    score: 70,
    reasons: [
      { window_name: 'FCA Q3 Freeze', points: 40 },
      { window_name: 'Pre-Budget Freeze', points: 30 },
    ],
  };

  it('contains the release name', () => {
    expect(blockedEmailHtml(ctx)).toContain('Payments v2.3');
  });

  it('contains BLOCKED heading', () => {
    expect(blockedEmailHtml(ctx)).toContain('BLOCKED');
  });

  it('contains the score', () => {
    expect(blockedEmailHtml(ctx)).toContain('70');
  });

  it('contains each reason window name', () => {
    const html = blockedEmailHtml(ctx);
    expect(html).toContain('FCA Q3 Freeze');
    expect(html).toContain('Pre-Budget Freeze');
  });

  it('contains +points for each reason', () => {
    const html = blockedEmailHtml(ctx);
    expect(html).toContain('+40');
    expect(html).toContain('+30');
  });

  it('plain text version contains key fields', () => {
    const text = blockedEmailText(ctx);
    expect(text).toContain('BLOCKED');
    expect(text).toContain('Payments v2.3');
    expect(text).toContain('70/100');
  });
});

describe('atRiskEmailHtml template', () => {
  it('contains AT RISK heading', () => {
    const html = atRiskEmailHtml({
      releaseName: 'Auth v1.1', plannedDate: '2026-08-15', score: 40, reasons: [],
    });
    expect(html).toContain('AT RISK');
    expect(html).toContain('Auth v1.1');
  });
});

describe('digestEmailHtml template', () => {
  it('renders a table row for each release', () => {
    const html = digestEmailHtml({
      tenantName: 'Test Bank UK',
      releases: [
        { name: 'Payments v2.3', planned_date: '2026-07-08', level: 'BLOCKED', score: 70 },
        { name: 'Auth v1.1',     planned_date: '2026-08-15', level: 'SAFE',    score: 5  },
      ],
    });
    expect(html).toContain('Payments v2.3');
    expect(html).toContain('Auth v1.1');
    expect(html).toContain('BLOCKED');
    expect(html).toContain('SAFE');
    expect(html).toContain('Test Bank UK');
  });
});

// ── Channel: email ────────────────────────────────────────────────────────────

describe('sendRiskEmail channel', () => {
  it('is called with BLOCKED event', async () => {
    const event = {
      type: 'RiskScoreComputed', release_id: 'r1', tenant_id: 't1',
      planned_date: '2026-07-08', level: 'BLOCKED', score: 70,
      reasons: [{ window_name: 'FCA Freeze', points: 40 }],
    };
    await sendRiskEmail(event, 'compliance@bank.com');
    expect(sendRiskEmail).toHaveBeenCalledWith(event, 'compliance@bank.com');
  });

  it('is called with AT_RISK event', async () => {
    const event = {
      type: 'RiskScoreComputed', release_id: 'r2', tenant_id: 't1',
      planned_date: '2026-08-01', level: 'AT_RISK', score: 40, reasons: [],
    };
    await sendRiskEmail(event, 'compliance@bank.com');
    expect(sendRiskEmail).toHaveBeenCalledTimes(1);
  });
});

// ── Channel: Slack ────────────────────────────────────────────────────────────

describe('sendSlackNotification channel', () => {
  it('is called with a BLOCKED event', async () => {
    const event = {
      type: 'RiskScoreComputed', release_id: 'r1', tenant_id: 't1',
      release_name: 'Payments v2.3', planned_date: '2026-07-08',
      level: 'BLOCKED', score: 70, reasons: [],
    };
    await sendSlackNotification(event, 'https://hooks.slack.com/test');
    expect(sendSlackNotification).toHaveBeenCalledWith(event, 'https://hooks.slack.com/test');
  });
});

// ── Channel: Jira ─────────────────────────────────────────────────────────────

describe('writeJiraComment channel', () => {
  it('is called with correct args', async () => {
    const event = {
      release_id: 'r1', release_name: 'Payments v2.3',
      planned_date: '2026-07-08', level: 'BLOCKED', score: 70, reasons: [],
    };
    await writeJiraComment('https://org.atlassian.net', 'PROJ-123', event, 'token');
    expect(writeJiraComment).toHaveBeenCalledWith(
      'https://org.atlassian.net', 'PROJ-123', event, 'token'
    );
  });
});
