import { query } from './_generated/server'

export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()

    if (!identity) {
      throw new Error('Not authenticated')
    }

    return {
      email: identity.email ?? null,
      issuer: identity.issuer,
      name: identity.name ?? null,
      subject: identity.subject,
      tokenIdentifier: identity.tokenIdentifier
    }
  }
})
