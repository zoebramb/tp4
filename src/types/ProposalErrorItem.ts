export interface ProposalErrorItem {
    id: number;
    reason: 'NOT_FOUND' | 'TIMEOUT' | 'ALREADY_IN_LIST' | 'CATALOG_ERROR';
    detail: string;
}