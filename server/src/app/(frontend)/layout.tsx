import React from 'react'
import './globals.css'

export const metadata = {
  description: 'AnySkin — Beauty & Skincare Product Database',
  title: 'AnySkin',
}

export default async function RootLayout(props: { children: React.ReactNode }) {
  const { children } = props

  return (
    <html lang="en">
      <body className="min-h-screen bg-background font-sans antialiased">
        <main className="container mx-auto py-8 px-4">{children}</main>
      </body>
    </html>
  )
}
