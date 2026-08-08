import type { ReactNode } from "react";
import useCurrentOrg from "../../hooks/useCurrentOrg";

import styles from "./OrgGuard.module.css";


interface Props {
    children: ReactNode;
}


export default function OrgGuard({
    children
}: Props){


const {
    organization
}=useCurrentOrg();



if(!organization){

return (

<div className={styles.empty}>

<h2>
No Organization Selected
</h2>

<p>
Connect a Salesforce organization before using this feature.
</p>

</div>

);

}


return children;

}