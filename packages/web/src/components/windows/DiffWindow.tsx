export function DiffWindow({ target }: { target: string }) {
  return (
    <div>
      <div className="w-path">{target}</div>
      <div className="w-pre" />
    </div>
  );
}
