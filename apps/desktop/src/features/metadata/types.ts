export interface MetadataType {
    xmlName: string;
    directoryName: string;
    suffix?: string;
    inFolder: boolean;
    metaFile: boolean;
    childXmlNames: string[];
}


export interface MetadataRetrieveResult {

    success: boolean;

    message: string;

    files?: string[];

}