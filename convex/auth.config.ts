import { AuthConfig } from 'convex/server'

export default {
  providers: [
    {
      // This is the same Clerk URL sometimes called the Frontend API URL.
      // Keep one source of truth and configure CLERK_JWT_ISSUER_DOMAIN in Convex.
      // See https://docs.convex.dev/auth/clerk#configuring-dev-and-prod-instances
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: 'convex'
    }
  ]
} satisfies AuthConfig
