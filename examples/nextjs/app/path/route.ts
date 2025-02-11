import { serve } from "@upstash/workflow/nextjs"
import fs from "fs";
import { headers } from "next/headers";
import path from "path";


export const { POST } = serve(
  async (context) => {

    // const { body: voiceFile, header, status } = await context.call(
    //   "transcribe-summary", // Step name
    //   {
    //     url: `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, // Endpoint URL
    //     method: "POST", // HTTP method
    //     body: { // Request body
    //       text: "this is a test",
    //       model_id: 'eleven_multilingual_v2',
    //       voice_settings: {
    //         stability: 0.5,
    //         similarity_boost: 0.5
    //       }
    //     },
    //     headers: {
    //       'Accept': 'audio/mpeg',
    //       'xi-api-key': ELEVENLABS_API_KEY,
    //       'Content-Type': 'application/json',
    //     }
    //   }
    // );

    // await context.run("save-audio", async () => {
    //   const fileName = `summary.mp3`;
    //   const filePath = path.join(__dirname, 'audio', fileName);

    //   // Ensure the audio directory exists
    //   fs.mkdirSync(path.join(__dirname, 'audio'), { recursive: true });

    //   // console.log(typeof voiceFile);
    //   // console.log(typeof voiceFile.split(""));
    //   // const result = voiceFile.split("").map(char => char.charCodeAt(0))
    //   // console.log(result.slice(0, 50));
    //   // console.log(new Buffer(result).slice(0, 50));

    //   // fs.writeFile(filePath, new Buffer(result), (err) => {
    //   //   if (err) {
    //   //     // return reject(err);
    //   //     throw new Error(err);
    //   //   }
    //   //   // resolve();
    //   // });

    //   fs.writeFile(filePath, voiceFile, { encoding: "binary" }, (err) => {
    //     if (err) {
    //       throw new Error(err);
    //     }
    //   })
    //   console.log(`Audio file saved: ${filePath}`);
    // })

    const { body: unicodeQuotes } = await context.call("unicode quotes", {
      url: "http://localhost:3001/unicode-quotes",
      method: "GET"
    })

    console.log(unicodeQuotes);


    // Buffer.from

  }, {
  retries: 0
}
)