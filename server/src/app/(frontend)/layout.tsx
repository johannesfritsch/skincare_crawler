import React from 'react'
import Link from 'next/link'
import './globals.css'

export const metadata = {
  description: 'AnySkin — Beauty & Skincare Product Database',
  title: 'AnySkin',
}

function AnySkinLogo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1483.79 342.81"
      className={className}
      aria-label="AnySkin"
    >
      <circle fill="#ffb680" cx="150.68" cy="180.82" r="150.68" />
      <circle fill="#ff8327" cx="226.03" cy="105.48" r="105.48" />
      <path
        fill="currentColor"
        d="M404.89,280.46l75.17-203h43.58l74.39,203h-41L538.52,227.1H463.09L444.3,280.46Zm69.95-87H527l-26.1-74.82Z"
      />
      <path
        fill="currentColor"
        d="M620.47,280.46V129.37H660.2v12.47q17.12-15.36,42.34-15.37,17.69,0,31.18,7.69a54.62,54.62,0,0,1,21,21.17q7.54,13.48,7.54,31.46v93.67H722.55V192.59q0-14.79-8.41-23.34t-22.91-8.56a39.67,39.67,0,0,0-18,3.92,35.4,35.4,0,0,0-13,11.16V280.46Z"
      />
      <path
        fill="currentColor"
        d="M805.78,342.81q-5.22,0-10-.43t-8-1V307.14a72.37,72.37,0,0,0,13.92,1.16q21.75,0,30.16-20.59l2.32-5.8L775.33,129.37h43.79l37.7,103,42.63-102.95h42.92l-69.6,163.27q-7.83,18.27-17.11,29.29a55.11,55.11,0,0,1-21.31,15.95Q822.31,342.82,805.78,342.81Z"
      />
      <path
        fill="currentColor"
        d="M1016.32,283.36A132.59,132.59,0,0,1,977.75,278,93.84,93.84,0,0,1,947,262.48l19.72-26.39a118.07,118.07,0,0,0,25.08,13,70,70,0,0,0,23.93,4.35q13.34,0,21.31-4.49t8-11.75a11.15,11.15,0,0,0-4.5-9.28q-4.5-3.48-14.35-4.93l-29-4.35q-22.62-3.48-34.22-14.64t-11.6-29.44q0-14.79,7.68-25.37t21.75-16.53q14.07-5.94,33.5-6a114.31,114.31,0,0,1,32.33,4.64,104,104,0,0,1,29.73,14.21l-19.14,25.81a101.32,101.32,0,0,0-23.78-11.31,77.51,77.51,0,0,0-22.91-3.48q-10.74,0-17.26,4.06t-6.52,10.73a11.29,11.29,0,0,0,4.64,9.57q4.64,3.48,16,4.93l28.71,4.35q22.62,3.19,34.51,14.36t11.89,28.85a40.6,40.6,0,0,1-8.7,25.67q-8.7,11.16-23.49,17.69T1016.32,283.36Z"
      />
      <path
        fill="currentColor"
        d="M1103.61,280.46v-203l39.73-6.67V192.88l65.25-63.51h45l-71.34,69.31,75.69,81.78h-50.75l-63.8-69v69Z"
      />
      <path
        fill="currentColor"
        d="M1289.5,111.39a22.77,22.77,0,0,1-22.62-22.62,21.6,21.6,0,0,1,6.67-16.09,22.55,22.55,0,0,1,38.57,16.09,22,22,0,0,1-6.53,16A21.6,21.6,0,0,1,1289.5,111.39Zm-19.72,169.07V129.37h39.73V280.46Z"
      />
      <path
        fill="currentColor"
        d="M1342,280.46V129.37h39.73v12.47q17.11-15.36,42.34-15.37,17.68,0,31.18,7.69a54.62,54.62,0,0,1,21,21.17q7.55,13.48,7.54,31.46v93.67h-39.73V192.59q0-14.79-8.41-23.34t-22.91-8.56a39.67,39.67,0,0,0-18,3.92,35.4,35.4,0,0,0-13,11.16V280.46Z"
      />
    </svg>
  )
}

export default async function RootLayout(props: { children: React.ReactNode }) {
  const { children } = props

  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body className="min-h-screen bg-background font-sans antialiased">
        <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="container mx-auto flex h-14 items-center justify-between px-4 sm:px-6">
            <div className="flex items-center gap-6">
              <Link href="/" className="flex items-center">
                <AnySkinLogo className="h-5 sm:h-6 w-auto" />
              </Link>
              <nav className="flex items-center gap-4 sm:gap-6 text-sm">
                <Link
                  href="/products"
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  Products
                </Link>
              </nav>
            </div>
          </div>
        </header>
        <main className="container mx-auto py-6 sm:py-8 px-4 sm:px-6">{children}</main>
        <footer className="border-t py-6">
          <div className="container mx-auto px-4 sm:px-6 flex items-center justify-between text-xs sm:text-sm text-muted-foreground">
            <p>AnySkin &mdash; Haut. Rein.</p>
            <a
              href="https://www.anyskin.app"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
            >
              anyskin.app
            </a>
          </div>
        </footer>
      </body>
    </html>
  )
}
