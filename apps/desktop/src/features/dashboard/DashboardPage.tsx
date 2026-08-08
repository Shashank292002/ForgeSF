import useCurrentOrg from "../../hooks/useCurrentOrg";

export default function DashboardPage() {

    const {
        organization
    } = useCurrentOrg();


    return (

        <div>


            <h1>
                ForgeSF Dashboard
            </h1>



            {
                organization ? (

                    <>

                        <h2>
                            Connected Organization
                        </h2>


                        <p>
                            Alias:
                            {" "}
                            {organization.alias}
                        </p>


                        <p>
                            Username:
                            {" "}
                            {organization.username}
                        </p>


                        <p>
                            Instance:
                            {" "}
                            {organization.instanceUrl}
                        </p>


                        <p>
                            Type:
                            {" "}
                            {organization.orgType}
                        </p>


                    </>

                )
                :
                (

                    <p>
                        No Salesforce organization connected.
                    </p>

                )
            }


        </div>

    );

}