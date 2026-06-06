export function atRiskEmailHtml({ releaseName, plannedDate, score, reasons }) {
  const reasonRows = reasons?.map((r) =>
    `<tr>
       <td style="padding:6px 12px;border-bottom:1px solid #fef3c7">${r.window_name}</td>
       <td style="padding:6px 12px;border-bottom:1px solid #fef3c7;text-align:right;font-weight:600;color:#d97706">+${r.points}</td>
     </tr>`
  ).join('') ?? '';

  return `<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;background:#f9fafb;padding:32px">
  <div style="max-width:560px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">
    <div style="background:#d97706;padding:24px 32px">
      <h1 style="color:white;margin:0;font-size:20px">⚠️ Release AT RISK</h1>
    </div>
    <div style="padding:32px">
      <p style="font-size:16px;color:#111827;margin-top:0"><strong>${releaseName}</strong></p>
      <p style="color:#6b7280">Planned date: <strong>${plannedDate}</strong></p>
      <div style="background:#fef3c7;border-radius:8px;padding:16px 20px;margin:20px 0">
        <span style="font-size:28px;font-weight:700;color:#d97706">${score}</span>
        <span style="color:#d97706;font-size:14px;margin-left:8px">/ 100 risk score</span>
      </div>
      ${reasonRows ? `
      <h3 style="color:#374151;font-size:14px;margin-bottom:8px">Contributing regulatory windows:</h3>
      <table style="width:100%;border-collapse:collapse;background:#fffbeb;border-radius:8px;overflow:hidden">
        ${reasonRows}
      </table>` : ''}
      <p style="color:#6b7280;font-size:13px;margin-top:24px">
        This release is near a regulatory window. Review before proceeding.
      </p>
    </div>
  </div>
</body>
</html>`;
}

export function atRiskEmailText({ releaseName, plannedDate, score, reasons }) {
  const lines = [`AT RISK: ${releaseName}`, `Planned: ${plannedDate}`, `Score: ${score}/100`, ''];
  reasons?.forEach((r) => lines.push(`  • ${r.window_name}: +${r.points} pts`));
  return lines.join('\n');
}
