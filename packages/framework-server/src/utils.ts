import sift, {SiftQuery, SupportedTypes} from "sift";
import {FilterQuery} from "@super-hornet/framework-shared";

export function findQuerySatisfied<T extends { [index: string]: any }>(target: T, query: FilterQuery<T>): boolean {
    //get rid of "Excessive stack depth comparing types 'any' and 'SiftQuery<T[]>'."
    return sift(query as any, [target] as any[]).length > 0;
}
