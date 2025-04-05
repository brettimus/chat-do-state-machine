# xstate + cloudflare agents-sdk + drizzle

## Setup
you need an openai api key to run this project.

```bash
cp .dev.vars.example .dev.vars
# edit .dev.vars with your openai api key
```

install deps and run the dev server
```bash
pnpm i
pnpm db:generate
pnpm dev
```

## Notes

- the drizzle migrations are executed automagically when the durable object is created