import { useParams } from "wouter";
import EstimateEditor from "./editor";

export default function EstimateDetail() {
  const { id } = useParams<{ id: string }>();
  return <EstimateEditor id={parseInt(id)} />;
}
