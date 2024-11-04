import { serve } from "../../platforms/express";
import express from 'express';
import { config } from 'dotenv';

// Load environment variables
config();

const app = express();

app.use(
    express.json()
);

app.use('/api/test', serve<{ message: string }>(async (context) => {
    const res1 = await context.run("step1", async () => {
        const message = context.requestPayload.message;
        return message;
    })

    await context.run("step2", async () => {
        console.log(res1);
    })
}));

app.listen(3000, () => {
    console.log('Server running on port 3000');
});