import OrgGuard from "../../components/OrgGuard/OrgGuard";
import MetadataRetriever from "./components/retrieve/MetadataRetriever";

export default function MetadataPage() {
  return (
    <OrgGuard>
      <div style={{ display: "flex", height: "100%", width: "100%" }}>
        <MetadataRetriever mode="page" />
      </div>
    </OrgGuard>
  );
}
