export function digestEmailHtml({ tenantName, releases }) {
  const rows = releases.map((r) =>
    `<tr>
       <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6">${r.name}</td>
       <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6">${r.planned_date}</td>
       <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-weight:600;color:${levelColor(r.level)}">${r.level}</td>
       <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;text-align:right">${r.score}</td>
     </tr>`
  ).join('');

  return `<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;background:#f9fafb;padding:32px">
  <div style="max-width:640px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">
    <div style="background:#1e40af;padding:24px 32px">
      <h1 style="color:white;margin:0;font-size:18px">Release Risk Digest — ${tenantName}</h1>
    </div>
    <div style="padding:32px">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:#f9fafb">
            <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280">RELEASE</th>
            <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280">DATE</th>
            <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280">LEVEL</th>
            <th style="padding:8px 12px;text-align:right;font-size:12px;color:#6b7280">SCORE</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>
</body>
</html>`;
}

function levelColor(level) {
  return { SAFE: '#16a34a', AT_RISK: '#d97706', BLOCKED: '#dc2626' }[level] ?? '#6b7280';
}
