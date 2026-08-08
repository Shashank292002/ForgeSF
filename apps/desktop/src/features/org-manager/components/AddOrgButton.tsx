import { useState } from "react";
import { Button } from "../../../components/ui";
import { connectSalesforce } from "../../../services/tauri";
import { useOrganizationStore } from "../../../store/orgStore";

export default function AddOrgButton() {

  const addOrganization =
    useOrganizationStore(
      (state) => state.addOrganization
    );


  const [loading, setLoading] =
    useState(false);



  async function handleClick() {

    try {

      setLoading(true);


      const organization =
        await connectSalesforce();


      console.log(
        "Connected Organization:",
        organization
      );


      addOrganization(
        organization
      );


    } catch (error) {

      console.error(
        "Failed to connect to Salesforce:",
        error
      );


    } finally {

      setLoading(false);

    }
  }



  return (
    <Button
      onClick={handleClick}
      disabled={loading}
    >
      {
        loading
          ? "Connecting..."
          : "Add Organization"
      }
    </Button>
  );
}