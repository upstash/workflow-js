import { serve } from "../../platforms/express";
import express from 'express';

const app = express();

app.use(
    express.json({
        limit: '5mb',
    })
);

app.use('/api/test', serve(async (context) => {
    const res1 = await context.run("step1", async () => {
        return "Hello World";
    })

    await context.run("step2", async () => {
        console.log(res1);
    })
}));

app.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
});