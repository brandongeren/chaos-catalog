import { SYNTAX_GUIDE } from '../syntax.ts'

export function SyntaxGuide() {
  const example = (e: string) => `?view=search&syntax=1&q=${encodeURIComponent(e)}`
  return (
    <div>
      <h2>Search syntax</h2>
      <p className="muted small">
        Turn on <strong>Syntax</strong> next to the search box and type filters as text. Everything you type must match (AND);
        commas inside one keyword mean "any of" (t:xyz,link). Keywords are case-insensitive.
      </p>
      <div className="table-scroll">
        <table className="printings guide">
          <thead>
            <tr>
              <th>Keyword</th>
              <th>Meaning</th>
              <th>Examples</th>
            </tr>
          </thead>
          <tbody>
            {SYNTAX_GUIDE.map((g) => (
              <tr key={g.keys}>
                <td>
                  <code>{g.keys}</code>
                </td>
                <td>{g.meaning}</td>
                <td>
                  {g.examples.map((e) => (
                    <a key={e} className="example" href={example(e)}>
                      <code>{e}</code>
                    </a>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small">
        Try:{' '}
        <a href={example('t:link a:dark atk>=2500 sort:atk')}>
          <code>t:link a:dark atk&gt;=2500 sort:atk</code>
        </a>{' '}
        ·{' '}
        <a href={example('t:tuner lv<=3 o:"special summon" gp>0')}>
          <code>t:tuner lv&lt;=3 o:"special summon" gp&gt;0</code>
        </a>
      </p>
    </div>
  )
}
