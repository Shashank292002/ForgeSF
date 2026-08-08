import type { Organization } from "../types";

import {
  openOrg,
  setDefaultOrg,
  logoutOrg
} from "../../../services/tauri";

// import {
//   updateOrganization
// } from "../../../services/storage";

import {
  useOrganizationStore
} from "../../../store/orgStore";

import styles from "./OrgCard.module.css";


interface Props {
  org: Organization;
}


export default function OrgCard({
  org
}: Props) {


  const removeOrganization =
    useOrganizationStore(
      state => state.removeOrganization
    );


  const setSelectedOrganization =
    useOrganizationStore(
      state => state.setSelectedOrganization
    );


  const selectedOrganization =
    useOrganizationStore(
      state => state.selectedOrganization
    );


  const isSelected =
    selectedOrganization?.id === org.id;



  async function handleOpenOrg() {

    try {

      await openOrg(
        org.username
      );

    } catch(error) {

      console.error(
        "Failed to open org:",
        error
      );

    }

  }




  async function handleSelect() {

    setSelectedOrganization(
      org
    );

  }




async function handleSetDefault() {

  try {

    await setDefaultOrg(
      org.username
    );


    setSelectedOrganization(
      org
    );


    console.log(
      "Active organization:",
      org.username
    );


  } catch(error){

    console.error(
      error
    );

  }

}





  async function handleRemove() {


    const confirmRemove =
      window.confirm(
        `Logout ${org.username}?`
      );


    if(!confirmRemove){
      return;
    }


    try {


      await logoutOrg(
        org.username
      );


      await removeOrganization(
        org.id
      );


    } catch(error) {


      console.error(
        "Failed to logout org:",
        error
      );


    }

  }





  return (

    <div
      className={
        `${styles.card} ${
          isSelected
          ? styles.selected
          : ""
        }`
      }
    >


      <div className={styles.header}>

        <h3 className={styles.title}>
          {
            org.alias ||
            org.username
          }
        </h3>


        {
          org.isDefault &&
          (
            <span className={styles.badge}>
              Default
            </span>
          )
        }


      </div>





      <div className={styles.info}>


        <p>
          <span className={styles.label}>
            Username:
          </span>

          {" "}
          {org.username}
        </p>



        <p>
          <span className={styles.label}>
            Org ID:
          </span>

          {" "}
          {org.id}
        </p>



        <p>
          <span className={styles.label}>
            Type:
          </span>

          {" "}
          {org.orgType}
        </p>



        <p>
          <span className={styles.label}>
            Instance:
          </span>

          {" "}
          {org.instanceUrl}
        </p>



        <p>

          <span className={styles.label}>
            Status:
          </span>


          {" "}

          <span
            className={
              org.status === "Connected"
              ? styles.connected
              : styles.disconnected
            }
          >
            ● {org.status}
          </span>


        </p>


      </div>





      {
        isSelected &&
        (
          <div className={styles.active}>
            ✅ Active Organization
          </div>
        )
      }





      <div className={styles.actions}>


        <button
          className={`${styles.button} ${styles.primary}`}
          onClick={handleSelect}
        >
          Select
        </button>




        <button
          className={styles.button}
          onClick={handleOpenOrg}
        >
          Open Org
        </button>




        <button
          className={styles.button}
          onClick={handleSetDefault}
        >
          Set Default
        </button>




        <button
          className={`${styles.button} ${styles.danger}`}
          onClick={handleRemove}
        >
          Logout
        </button>


      </div>


    </div>

  );

}