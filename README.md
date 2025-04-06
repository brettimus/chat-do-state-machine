# xstate + cloudflare agents-sdk + drizzle

This is a modified version of the Cloudflare Agents SDK example project.

Instead of using the `ChatAgent` class, I've tried to implement something more suitable to our use case by extending the base `Agent` class.

Drizzle handles interfacing with the DO's sqlite database.

- `src/server.ts` contains the main logic for the agent.
- `src/client.tsx` contains the frontend code for talking to the agent.

## Setup

you need an openai api key to run this project.

```bash
cp .dev.vars.example .dev.vars
# edit .dev.vars and add your openai api key
```

install deps, generate migration files, and run the dev server

```bash
pnpm i
pnpm db:generate
pnpm dev
```

## Notes

### State Machines

XState is used in this example on both the frontend and backend.

- the `xstate-prototypes` directory is just a copy-paste of the one from the `spectacular` repo
- the frontend also uses a state machine to handle certain control flow around components

### Drizzle

- the drizzle migrations are executed automagically when the durable object is created

- there is a custom Vite plugin to handle importing of the sql files in the migrations folder - it probably needs a more thorough view

- i hackily configured Drizzle Studio for local use `pnpm db:studio`
