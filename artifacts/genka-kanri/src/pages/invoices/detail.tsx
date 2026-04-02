import { useParams } from "wouter";
import InvoiceEditor from "./editor";

export default function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  return <InvoiceEditor id={parseInt(id)} />;
}
