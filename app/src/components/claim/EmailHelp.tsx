// How to get the original .eml file. Forwarded emails break the signature.
export function EmailHelp() {
  return (
    <details className="cl-help">
      <summary>How do I get the .eml file?</summary>
      <p style={{ marginTop: 8 }}>Use the original email, not a forward. Forwarding breaks the signature.</p>
      <ul>
        <li><b>Gmail:</b> open the email, click the three dots, then Download message.</li>
        <li><b>Proton Mail:</b> open the email, click the three dots, then Export.</li>
        <li><b>Yahoo:</b> open the email, click the three dots, then View raw message, then Download.</li>
        <li><b>Outlook:</b> open the email, click the three dots, then Save as (desktop: File, Save as, .eml).</li>
        <li><b>Apple Mail:</b> select the email, then File, Save As, Raw Message Source.</li>
      </ul>
    </details>
  );
}
