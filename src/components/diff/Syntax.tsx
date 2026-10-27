export function Syntax({ text }: { text: string }) {
  return <>{text.split(/('[^']*'|"[^"]*"|\b(?:import|from|export|function|return|const|let|type|interface|async|await)\b)/g).map((token, index) => {
    const className = /^['"]/.test(token) ? 'syntax-string' : /^(import|from|export|function|return|const|let|type|interface|async|await)$/.test(token) ? 'syntax-keyword' : '';
    return className ? <span key={index} className={className}>{token}</span> : token;
  })}</>;
}
