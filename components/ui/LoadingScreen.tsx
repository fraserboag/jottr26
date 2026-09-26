import { Icon } from '@/components/ui/Icon'

/** The whole screen, while something the app cannot start without loads. */
export function LoadingScreen({ label }: { label: string }) {
  return (
    <div className="grid h-dvh place-items-center bg-surface">
      <div className="flex items-center gap-1.5 text-muted">
        <Icon name="refresh" size={16} className="animate-spin" />
        <span>{label}</span>
      </div>
    </div>
  )
}
