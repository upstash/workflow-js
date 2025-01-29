
import { serveMany } from "@upstash/workflow";
import { z } from "zod";

export const { POST } = serveMany({
  routes: {
    "route-one": {
      route: async (context) => {
        await context.run("print", () => console.log("hello"));
        await context.run("print", () => console.log("from"));
        await context.run("print", () => console.log("route"));
        await context.run("print", () => console.log("one"));
        await context.invoke("invoking", {routeName: "route-two", body: 4})
        await context.run("print", () => console.log("hello"));
        await context.run("print", () => console.log("from"));
        await context.run("print", () => console.log("route"));
        await context.run("print", () => console.log("one"));
      },
      options: {
        schema: z.string()
      }
    },
    "route-two": {
      route: async (context) => {
        await context.run("print", () => console.log("XXX hello"));
        await context.run("print", () => console.log("XXX from"));
        await context.run("print", () => console.log("XXX route"));
        await context.run("print", () => console.log("XXX two"));
      },
      options: {
        schema: z.number()
      }
    }
  },
  defaultRoute: "route-one"
})
