/**
 * Email template for BLOCKED releases.
 */
export function blockedEmailHtml({ releaseName, plannedDate, score, reasons }) {
  const reasonRows = reasons?.map((r) =>
    `<tr>
       <td style="padding:6px 12px;border-bottom:1px solid #fee2e2">${r.window_name}</td>
       <td style="padding:6px 12px;border-bottom:1px solid #fee2e2;text-align:right;font-weight:600;color:#dc2626">+${r.points}</td>
     </tr>`
  ).join('') ?? '';

  return `<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;background:#f9fafb;padding:32px">
  <div style="max-width:560px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">
    <div style="background:#dc2626;padding:24px 32px">
      <h1 style="color:white;margin:0;font-size:20px">🚨 Release BLOCKED</h1>
    </div>
    <div style="padding:32px">
      <p style="font-size:16px;color:#111827;margin-top:0"><strong>${releaseName}</strong></p>
      <p style="color:#6b7280">Planned date: <strong>${plannedDate}</strong></p>
      <div style="background:#fee2e2;border-radius:8px;padding:16px 20px;margin:20px 0">
        <span style="font-size:28px;font-weight:700;color:#dc2626">${score}</span>
        <span style="color:#dc2626;font-size:14px;margin-left:8px">/ 100 risk score</span>
      </div>
      ${reasonRows ? `
      <h3 style="color:#374151;font-size:14px;margin-bottom:8px">Contributing regulatory windows:</h3>
      <table style="width:100%;border-collapse:collapse;background:#fff5f5;border-radius:8px;overflow:hidden">
        ${reasonRows}
      </table>` : ''}
      <p style="color:#6b7280;font-size:13px;margin-top:24px">
        This release falls within or near a regulatory blackout/freeze window.<br>
        Please review and reschedule before proceeding.
      </p>
    </div>
  </div>
</body>
</html>`;
}

export function blockedEmailText({ releaseName, plannedDate, score, reasons }) {
  const lines = [`BLOCKED: ${releaseName}`, `Planned: ${plannedDate}`, `Score: ${score}/100`, ''];
  reasons?.forEach((r) => lines.push(`  • ${r.window_name}: +${r.points} pts`));
  return lines.join('\n');
}
