import { Inspector } from "./inspector";

export default function Home() {
  return <Inspector hasApiKey={Boolean(process.env.TYPESAFE_API_KEY)} />;
}
