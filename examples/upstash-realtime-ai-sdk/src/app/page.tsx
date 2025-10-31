import { redis } from "@/lib/redis";
import { UIMessage } from "ai";
import { Chat } from "@/components/chat";

type Params = Promise<{ chatId?: string }>;

const Page = async ({ searchParams }: { searchParams: Params }) => {
  const { chatId } = await searchParams;

  const history = await redis.get<UIMessage[]>(`history:${chatId}`) || [];

  return <Chat initialHistory={chatId ? { [chatId]: history } : {}} />;
};

export default Page;
