import { UserCircle2 } from 'lucide-react'

export const metadata = {
  title: 'Profile — AnySkin',
}

export default function ProfilePage() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
        <UserCircle2 className="h-8 w-8 text-muted-foreground" />
      </div>
      <h1 className="text-lg font-semibold tracking-tight mb-1">Profile</h1>
      <p className="text-sm text-muted-foreground max-w-xs">
        Saved products, scan history, and preferences will appear here soon.
      </p>
    </div>
  )
}
