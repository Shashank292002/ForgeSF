import {
    useOrganizationStore
} from "../../store/orgStore";

import styles from "./AppHeader.module.css";


export default function AppHeader(){

    const organization =
        useOrganizationStore(
            state =>
            state.selectedOrganization
        );


    return (

        <header className={styles.header}>


            <div className={styles.brand}>

                <span className={styles.logo}>
                    ⚡
                </span>


                <span className={styles.title}>
                    ForgeSF
                </span>

            </div>



            <div className={styles.actions}>


                {
                    organization ?

                    (
                        <span>
                            🟢 {organization.alias}
                        </span>
                    )

                    :

                    (

                        <span>
                            No Org
                        </span>

                    )

                }


            </div>


        </header>

    );

}