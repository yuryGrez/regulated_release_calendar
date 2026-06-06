import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import RiskBadge from '../RiskBadge.jsx';

describe('RiskBadge', () => {
  // ── Rendering ─────────────────────────────────────────────────────────────

  it('renders SAFE with score', () => {
    render(<RiskBadge level="SAFE" score={12} />);
    const badge = screen.getByTestId('risk-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('SAFE');
    expect(badge).toHaveTextContent('(12)');
  });

  it('renders AT_RISK as "AT RISK" with score', () => {
    render(<RiskBadge level="AT_RISK" score={45} />);
    expect(screen.getByTestId('risk-badge')).toHaveTextContent('AT RISK');
    expect(screen.getByTestId('risk-badge')).toHaveTextContent('(45)');
  });

  it('renders BLOCKED with score', () => {
    render(<RiskBadge level="BLOCKED" score={82} />);
    expect(screen.getByTestId('risk-badge')).toHaveTextContent('BLOCKED');
    expect(screen.getByTestId('risk-badge')).toHaveTextContent('(82)');
  });

  // ── Colour classes ────────────────────────────────────────────────────────

  it('applies green pill class for SAFE', () => {
    render(<RiskBadge level="SAFE" score={10} />);
    // The outer <span> is the pill — it carries the colour classes
    const pill = screen.getByLabelText(/Risk level: SAFE/i);
    expect(pill.className).toMatch(/green/);
  });

  it('applies amber pill class for AT_RISK', () => {
    render(<RiskBadge level="AT_RISK" score={40} />);
    const pill = screen.getByLabelText(/Risk level: AT RISK/i);
    expect(pill.className).toMatch(/amber/);
  });

  it('applies red pill class for BLOCKED', () => {
    render(<RiskBadge level="BLOCKED" score={82} />);
    const pill = screen.getByLabelText(/Risk level: BLOCKED/i);
    expect(pill.className).toMatch(/red/);
  });

  // ── Pulse animation ───────────────────────────────────────────────────────

  it('adds animate-pulse dot for BLOCKED', () => {
    render(<RiskBadge level="BLOCKED" score={82} />);
    const dot = screen.getByTestId('risk-badge').querySelector('span span');
    expect(dot.className).toMatch(/animate-pulse/);
  });

  it('does NOT add animate-pulse for SAFE', () => {
    render(<RiskBadge level="SAFE" score={5} />);
    const dot = screen.getByTestId('risk-badge').querySelector('span span');
    expect(dot.className).not.toMatch(/animate-pulse/);
  });

  // ── Tooltip ───────────────────────────────────────────────────────────────

  it('shows tooltip with reasons on hover', () => {
    const reasons = [
      { window_name: 'FCA Q3 Freeze', points: 40 },
      { window_name: 'Pre-Budget Freeze', points: 30 },
    ];
    render(<RiskBadge level="BLOCKED" score={70} reasons={reasons} />);

    const pill = screen.getByTestId('risk-badge').querySelector('span');
    fireEvent.mouseEnter(pill);

    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    expect(screen.getByRole('tooltip')).toHaveTextContent('FCA Q3 Freeze');
    expect(screen.getByRole('tooltip')).toHaveTextContent('+40');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Pre-Budget Freeze');
  });

  it('hides tooltip on mouse leave', () => {
    const reasons = [{ window_name: 'Test window', points: 40 }];
    render(<RiskBadge level="BLOCKED" score={40} reasons={reasons} />);

    const pill = screen.getByTestId('risk-badge').querySelector('span');
    fireEvent.mouseEnter(pill);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.mouseLeave(pill);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('does not render tooltip when reasons are empty', () => {
    render(<RiskBadge level="BLOCKED" score={82} reasons={[]} />);
    const pill = screen.getByTestId('risk-badge').querySelector('span');
    fireEvent.mouseEnter(pill);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  // ── Size variants ─────────────────────────────────────────────────────────

  it('renders sm size without crashing', () => {
    render(<RiskBadge level="SAFE" score={5} size="sm" />);
    expect(screen.getByTestId('risk-badge')).toBeInTheDocument();
  });

  it('renders md size without crashing', () => {
    render(<RiskBadge level="AT_RISK" score={40} size="md" />);
    expect(screen.getByTestId('risk-badge')).toBeInTheDocument();
  });

  // ── Unknown level fallback ────────────────────────────────────────────────

  it('falls back gracefully for unknown level', () => {
    render(<RiskBadge level="UNKNOWN" score={0} />);
    // Should not throw; renders with SAFE styling as fallback
    expect(screen.getByTestId('risk-badge')).toBeInTheDocument();
  });

  // ── Accessibility ─────────────────────────────────────────────────────────

  it('has aria-label with level and score', () => {
    render(<RiskBadge level="SAFE" score={12} />);
    const pill = screen.getByLabelText(/Risk level: SAFE, score 12/i);
    expect(pill).toBeInTheDocument();
  });
});
