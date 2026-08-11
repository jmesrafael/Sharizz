function formatBytes(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 0.1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${Math.max(mb, 0.1).toFixed(1)} MB`;
}

export default function StorageMeter({ usedBytes, limitBytes }: { usedBytes: number; limitBytes: number }) {
  const pct = limitBytes > 0 ? Math.min(usedBytes / limitBytes, 1) : 0;
  const remaining = Math.max(limitBytes - usedBytes, 0);

  return (
    <div className="storage-meter" title={`${formatBytes(usedBytes)} of ${formatBytes(limitBytes)} used`}>
      <div className="storage-meter-track">
        <div className="storage-meter-fill" style={{ width: `${pct * 100}%` }} />
      </div>
      <span className="storage-meter-text">
        {formatBytes(remaining)} left of {formatBytes(limitBytes)}
      </span>
    </div>
  );
}
