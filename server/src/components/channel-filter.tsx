'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

export interface ChannelOption {
  id: number
  creatorName: string
  platform: string
  imageUrl: string | null
  videoCount: number
}

export function ChannelFilter({ channels }: { channels: ChannelOption[] }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeChannel = searchParams.get('channel')

  function select(channelId: string | null) {
    const params = new URLSearchParams(searchParams.toString())
    if (channelId) {
      params.set('channel', channelId)
    } else {
      params.delete('channel')
    }
    router.push(`/videos?${params.toString()}`, { scroll: false })
  }

  if (channels.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto -mx-4 scrollbar-none">
        <div className="inline-flex gap-2 px-4 pb-1">
          {/* "All" chip */}
          <button
            onClick={() => select(null)}
            className={cn(
              'flex items-center gap-2 shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              !activeChannel
                ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                : 'bg-card text-muted-foreground border-border hover:border-primary/30 hover:text-foreground',
            )}
          >
            All
          </button>

          {/* Channel chips */}
          {channels.map((ch) => {
            const isActive = activeChannel === String(ch.id)
            return (
              <button
                key={ch.id}
                onClick={() => select(isActive ? null : String(ch.id))}
                className={cn(
                  'flex items-center gap-2 shrink-0 rounded-full border pl-1.5 pr-3 py-1 text-xs font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                    : 'bg-card text-muted-foreground border-border hover:border-primary/30 hover:text-foreground',
                )}
              >
                <Avatar size="sm" className={cn(isActive && 'ring-1 ring-primary-foreground/30')}>
                  {ch.imageUrl && <AvatarImage src={ch.imageUrl} alt={ch.creatorName} />}
                  <AvatarFallback className={cn('text-[9px]', isActive && 'bg-primary-foreground/20 text-primary-foreground')}>
                    {ch.creatorName.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate max-w-24">{ch.creatorName}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
