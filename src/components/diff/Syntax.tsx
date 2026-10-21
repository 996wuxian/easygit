export function Syntax({ text }: { text: string }) {
  return <>{text.split(/('[^']*'|"[^"]*"|\b(?:import|from|export|function|return|const|let|type|interface|async|await)\b)/g).map((token, index) => <span key={index} className={/^['"]/.test(token) ? 'syntax-string' : /^(import|from|export|function|return|const|let|type|interface|async|await)$/.test(token) ? 'syntax-keyword' : ''}>{token}</span>)}</>;
}
