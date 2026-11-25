export interface ProductDTO {
    id: number;
    title: string;
    price: number;
    thumbnail: string;
    proposedBy: string;
    votesCount: number;
    voters: string[]; // Nombres de quienes votaron (útil para que el cliente sepa si ya votó)
}